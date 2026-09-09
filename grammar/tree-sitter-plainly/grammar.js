/**
 * Tree-sitter grammar for Plainly.
 *
 * This powers editor tooling (highlighting, folding, errors-as-you-type).
 * It mirrors the reference parser in src/lexer.ts + src/parser.ts:
 *   - indentation-based blocks via an external scanner (INDENT/DEDENT)
 *   - NEWLINE as an explicit token inside blocks
 *   - `otherwise` / `otherwise if` chains
 *   - precedence: or < and < equality < comparison < additive
 *                 < multiplicative < unary < postfix (call/index)
 */

module.exports = grammar({
  name: "plainly",

  word: $ => $.identifier,

  extras: $ => [
    /\s+/,
    $.comment,
  ],

  externals: $ => [
    $.newline,
    $.indent,
    $.dedent,
  ],

  rules: {
    program: $ => repeat($._statement),

    _statement: $ => choice(
      $.say_statement,
      $.set_statement,
      $.if_statement,
      $.for_each_statement,
      $.repeat_statement,
      $.function_definition,
      $.return_statement,
      $.expression_statement,
    ),

    say_statement: $ => seq("say", $._expression),

    set_statement: $ => seq("set", $.identifier, "=", $._expression),

    if_statement: $ => seq(
      "if",
      $._expression,
      ":",
      $.block,
      optional(
        seq(
          "otherwise",
          choice($.if_statement, seq(":", $.block)),
        ),
      ),
    ),

    for_each_statement: $ => seq(
      "for", "each", $.identifier, "in", $._expression, ":", $.block,
    ),

    repeat_statement: $ => seq(
      "repeat", $._expression, "times", ":", $.block,
    ),

    function_definition: $ => seq(
      "function", $.identifier, "(", optional($.parameter_list), ")", ":", $.block,
    ),

    parameter_list: $ => seq($.identifier, repeat(seq(",", $.identifier))),

    return_statement: $ => seq("return", optional($._expression)),

    expression_statement: $ => $._expression,

    block: $ => seq($.indent, repeat1(seq($._statement, optional($.newline))), $.dedent),

    // ----- expressions -----

    _expression: $ => choice(
      $.binary_expression,
      $.unary_expression,
      $.call_expression,
      $.index_expression,
      $.identifier,
      $.number,
      $.string,
      $.boolean,
      $.list_literal,
      $.parenthesized_expression,
    ),

    binary_expression: $ => choice(
      ...prec.left(1, seq($._expression, "or", $._expression)),
      ...prec.left(2, seq($._expression, "and", $._expression)),
      ...prec.left(3, seq($._expression, choice("==", "!="), $._expression)),
      ...prec.left(4, seq($._expression, choice(">", "<", ">=", "<="), $._expression)),
      ...prec.left(5, seq($._expression, choice("+", "-"), $._expression)),
      ...prec.left(6, seq($._expression, choice("*", "/", "%"), $._expression)),
    ),

    unary_expression: $ => prec(7, seq(choice("not", "-"), $._expression)),

    call_expression: $ => prec.left(8, seq($._expression, "(", optional($.argument_list), ")")),
    argument_list: $ => seq($._expression, repeat(seq(",", $._expression))),

    index_expression: $ => prec.left(8, seq($._expression, "[", $._expression, "]")),

    list_literal: $ => seq(
      "[",
      optional(seq($._expression, repeat(seq(",", $._expression)), optional(","))),
      "]",
    ),

    parenthesized_expression: $ => seq("(", $._expression, ")"),

    // ----- tokens -----

    identifier: $ => /[A-Za-z_][A-Za-z0-9_]*/,

    number: $ => /\d+(\.\d+)?/,

    string: $ => token(seq('"', repeat(choice(/[^"\\\n\r]/, /\\./)), '"')),

    boolean: $ => choice("true", "false"),

    comment: $ => token(seq("#", /[^\r\n]*/)),
  },
});
