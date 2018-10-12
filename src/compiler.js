/*
Copyright (c) 2014, Yahoo! Inc. All rights reserved.
Copyrights licensed under the New BSD License.
See the accompanying LICENSE file for terms.
*/

/* jslint esnext: true */

export default Compiler;

function Compiler(locales, formats, pluralFn) {
    this.locales  = locales;
    this.formats  = formats;
    this.pluralFn = pluralFn;
}

Compiler.prototype.compile = function (ast) {
    this.pluralStack        = [];
    this.currentPlural      = null;
    this.pluralNumberFormat = null;

    return this.compileMessage(ast);
};

Compiler.prototype.compileMessage = function (ast) {
    if (!(ast && ast.type === 'messageFormatPattern')) {
        throw new Error('Message AST is not of type: "messageFormatPattern"');
    }

    var elements = ast.elements,
        pattern  = [];

    var i, len, element;

    for (i = 0, len = elements.length; i < len; i += 1) {
        element = elements[i];

        switch (element.type) {
            case 'messageTextElement':
                pattern.push(this.compileMessageText(element));
                break;

            case 'argumentElement':
                pattern.push(this.compileArgument(element));
                break;

            default:
                throw new Error('Message element does not have a valid type');
        }
    }

    return pattern;
};

Compiler.prototype.compileMessageText = function (element) {
    // When this `element` is part of plural sub-pattern and its value contains
    // an unescaped '#', use a `PluralOffsetString` helper to properly output
    // the number with the correct offset in the string.
    if (this.currentPlural && /(^|[^\\])#/g.test(element.value)) {
        // Create a cache a NumberFormat instance that can be reused for any
        // PluralOffsetString instance in this message.
        if (!this.pluralNumberFormat) {
            this.pluralNumberFormat = new Intl.NumberFormat(this.locales);
        }

        return new PluralOffsetString(
                this.currentPlural.id,
                this.currentPlural.format.offset,
                this.pluralNumberFormat,
                element.value);
    }

    // Unescape the escaped '#'s in the message text.
    return element.value.replace(/\\#/g, '#');
};

Compiler.prototype.compileArgument = function (element) {
    var format = element.format;

    if (!format) {
        return new StringFormat(element.id);
    }

    var formats  = this.formats,
        locales  = this.locales,
        pluralFn = this.pluralFn,
        options;

    switch (format.type) {
        case 'numberFormat':
            options = formats.number[format.style];
            return {
                id    : element.id,
                format: new Intl.NumberFormat(locales, options).format
            };

        case 'shortNumberFormat':
            options = formats.number[format.style];
            return {
                id    : element.id,
                format: new ShortNumberFormat(locales, options).format
            };

        case 'dateFormat':
            options = formats.date[format.style];
            return {
                id    : element.id,
                format: new Intl.DateTimeFormat(locales, options).format
            };

        case 'timeFormat':
            options = formats.time[format.style];
            return {
                id    : element.id,
                format: new Intl.DateTimeFormat(locales, options).format
            };

        case 'pluralFormat':
            options = this.compileOptions(element);
            return new PluralFormat(
                element.id, format.ordinal, format.offset, options, pluralFn
            );

        case 'selectFormat':
            options = this.compileOptions(element);
            return new SelectFormat(element.id, options);

        default:
            throw new Error('Message element does not have a valid format type');
    }
};

Compiler.prototype.compileOptions = function (element) {
    var format      = element.format,
        options     = format.options,
        optionsHash = {};

    // Save the current plural element, if any, then set it to a new value when
    // compiling the options sub-patterns. This conforms the spec's algorithm
    // for handling `"#"` syntax in message text.
    this.pluralStack.push(this.currentPlural);
    this.currentPlural = format.type === 'pluralFormat' ? element : null;

    var i, len, option;

    for (i = 0, len = options.length; i < len; i += 1) {
        option = options[i];

        // Compile the sub-pattern and save it under the options's selector.
        optionsHash[option.selector] = this.compileMessage(option.value);
    }

    // Pop the plural stack to put back the original current plural value.
    this.currentPlural = this.pluralStack.pop();

    return optionsHash;
};

// -- Compiler Helper Classes --------------------------------------------------

function StringFormat(id) {
    this.id = id;
}

StringFormat.prototype.format = function (value) {
    if (!value && typeof value !== 'number') {
        return '';
    }

    return typeof value === 'string' ? value : String(value);
};

function PluralFormat(id, useOrdinal, offset, options, pluralFn) {
    this.id         = id;
    this.useOrdinal = useOrdinal;
    this.offset     = offset;
    this.options    = options;
    this.pluralFn   = pluralFn;
}

PluralFormat.prototype.getOption = function (value) {
    var options = this.options;

    var option = options['=' + value] ||
            options[this.pluralFn(value - this.offset, this.useOrdinal)];

    return option || options.other;
};

function PluralOffsetString(id, offset, numberFormat, string) {
    this.id           = id;
    this.offset       = offset;
    this.numberFormat = numberFormat;
    this.string       = string;
}

PluralOffsetString.prototype.format = function (value) {
    var number = this.numberFormat.format(value - this.offset);

    return this.string
            .replace(/(^|[^\\])#/g, '$1' + number)
            .replace(/\\#/g, '#');
};

function SelectFormat(id, options) {
    this.id      = id;
    this.options = options;
}

SelectFormat.prototype.getOption = function (value) {
    var options = this.options;
    return options[value] || options.other;
};

function ShortNumberFormat(locales, options) {
    this.__locales__    = locales;
    this.__options__    = options;
    this.__localeData__ = IntlMessageFormat.__localeData__;
}

// var localeData = IntlMessageFormat.__localeData__[locale]['numbers']['decimalFormats-numberSystem-latn']['short'];
ShortNumberFormat.prototype.format = function (value) {
  // coerce to number
  var number = Number(value);

  // take array of locales and reduce to find matching locale.  Then get the rule based on range number is in, number of zeros
  // perhaps convert number to decimal and format (e.g. 1.234 && "0K")
  var rules = this.__locales__.reduce(function (locale) {
    return this.__localeData__[locale] ? this.__localeData__[locale].numbers.decimal.short : null;
  });

  if (rules.length === 0) {
    return value;
  }

  // just now assuming first locale matches.  TODO: loop through and find first match
  // matchingRules = [
  //   [1000, {one: ["0K", 1], other: ["0K", 1]}],
  //   [10000, %{one: ["00K", 2], other: ["00K", 2]}]
  // ]
  var matchingRules = rules[0];

  // 1. Take value and determine range it is in - e.g. 1000 for 1765
  // 2. Extract specific rule from hash - ["0K", 1] meaning which value from the rule and number of zeros
  var matchingRule = matchingRules.filter(function (rule) {
    return isLessThanBoundary(value, boundary);
  }).reverse()[0];

  // 3. Normalise number by converting to decimal and cropping to number of digits
  // 22 -> 22
  // 1000 -> 1.000 -> 1K
  // 1600 -> 1.600 -> 2K
  // 1600.9 -> 1.600 -> 2K
  // 1,000,543 -> 1.000.543 -> 1M
  // 4. Format according to formatter e.g. "0K"
  if (number < 1000) {
    return value;
  } else {
    var range = matchingRule[0];
    var format = matchingRule[1].one[0];
    var numberOfDigits = matchingRule[1].one[1];
    var normalized = normalizeNumber(number, range, numberOfDigits);
    return formatNumber(normalized, format);
  }
};

function isLessThanBoundary(value, boundary) {
  if (value <= boundary) {
    return true;
  }
  return false;
}

function normalizeNumber(number, range, numberOfDigits) {
  // 1734 -> 1.734
  // 17345 -> 17.345
  return number / (range / Math.pow(10, numberOfDigits - 1));
}

function formatNumber(number, format) {
  // 1.734 -> 1K
  return format.replace(/0*(\w+)/, number + '$1');
}
