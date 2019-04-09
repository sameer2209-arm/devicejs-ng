'use strict'

/*
 * Copyright (c) 2018, Arm Limited and affiliates.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Ex1: ((interface="" or type="") and id="") or group="A/B/*"
// Ex2: A and (B or C) and D
// BNF Grammar
//     <predicate>      ::= <term> | <term> 'or' <predicate>
//     <term>           ::= <factor> | <factor> 'and' <term>
//     <factor>         ::= <property> | '(' <predicate> ')' | 'not' <factor>
//     <property>       ::= <property-name> '=' <property-value>
//     <property-name>  ::= 'interface' | 'group' | 'type' | 'id'
//     <property-value> ::= '*' | \"([^\"\\]|\\"|\\\\|\\\/|\\b|\\f|\\n|\\r|\\t|(\\u([0-9A-F]{4}|([0-9a-f]{4}))))*\"
// BNF Grammar (Left Factored)
//     <predicate>      ::= <term> <predicate-tail>
//     <predicate-tail> ::= nil | 'or' <predicate>
//     <term>           ::= <factor> <term-tail>
//     <term-tail>      ::= nil | 'and' <term>
//     <factor>         ::= <property> | '(' <predicate> ')' | 'not' <factor>
//     <property>       ::= <property-name> '=' <property-value>
//     <property-name>  ::= 'interface' | 'group' | 'type' | 'id'
//     <property-value> ::= '*' | \"([^\"\\]|\\"|\\\\|\\\/|\\b|\\f|\\n|\\r|\\t|(\\u([0-9A-F]{4}|([0-9a-f]{4}))))*\"

const util = require('util')

const TERMINALS = [ 
    'and',
    'or',
    'not',
    '(',
    ')',
    '=',
    '*',
    'interface',
    'type',
    'id',
    'group'
]

const JSON_STRING_REGEX = /\"([^\"\\]|\\"|\\\\|\\\/|\\b|\\f|\\n|\\r|\\t|(\\u([0-9A-F]{4}|([0-9a-f]{4}))))*\"/

class SelectionTokenizer {
    constructor(selectionString) {
        this.selectionString = selectionString
        this.nextCharIndex = 0
        this.currentToken = null
    }
    
    getCurrentToken() {
        return this.currentToken
    }
    
    next() {
        // skip all whitespace
        while(this.nextCharIndex < this.selectionString.length && /\s/.test(this.selectionString[this.nextCharIndex])) {
            this.nextCharIndex += 1
        }
    
        // if we have reached the end, there are no more tokens
        if(this.nextCharIndex == this.selectionString.length) {
            this.currentToken = null
            return this.currentToken
        }
    
        for(var i = 0; i < TERMINALS.length; i++) {
            if(this.selectionString.indexOf(TERMINALS[i], this.nextCharIndex) == this.nextCharIndex) {
                this.nextCharIndex += TERMINALS[i].length
                this.currentToken = new TerminalToken(TERMINALS[i])
                return this.currentToken
            }
        }
    
        var jsonStringMatch = this.selectionString.substring(this.nextCharIndex).match(JSON_STRING_REGEX)
    
        if(jsonStringMatch && jsonStringMatch.index == 0) {
            this.currentToken = new StringToken(jsonStringMatch[0])
            this.nextCharIndex += jsonStringMatch[0].length
            return this.currentToken
        }
        else {
            throw new Error('Invalid token')
        }
    }
}

class Token {
    constructor(value) {
        this.value = value
    }
    
    getValue() {
        return this.value
    }
}

class TerminalToken extends Token {
}

class StringToken extends Token {
    getStringValue() {
        return JSON.parse(this.getValue())
    }
}

class SelectionParser {
    constructor(selectionTokenizer) {
        this.tokenizer = selectionTokenizer
    }
    
    parse() {
        var tokenizer = this.tokenizer

        function parsePredicate() {
            var term = parseTerm()
            var predicateTail = parsePredicateTail()
    
            if(predicateTail) {
                return new OrNode(term, predicateTail)
            }
            else {
                return term
            }
        }
    
        function parsePredicateTail() {
            if(tokenizer.getCurrentToken()) {
                if(tokenizer.getCurrentToken().getValue() == 'or') {
                    tokenizer.next()
                    return parsePredicate()
                }
                else {
                    return null
                }
            }
            else {
                return null
            }
        }
    
        function parseTerm() {
            var factor = parseFactor()
            var termTail = parseTermTail()
    
            if(termTail) {
                return new AndNode(factor, termTail)
            }
            else {
                return factor
            }
        }
    
        function parseTermTail() {
            if(tokenizer.getCurrentToken()) {
                if(tokenizer.getCurrentToken().getValue() == 'and') {
                    tokenizer.next()
                    return parseTerm()
                }
                else {
                    return null
                }
            }
            else {
                return null
            }
        }
    
        function parseFactor() {
            if(tokenizer.getCurrentToken()) {
                if(tokenizer.getCurrentToken().getValue() == '(') {
                    tokenizer.next()
                    var p = parsePredicate()
    
                    if(tokenizer.getCurrentToken().getValue() == ')') {
                        tokenizer.next()
                        return p
                    }
                    else {
                        throw new Error('Parse error')
                    }
                }
                else if(tokenizer.getCurrentToken().getValue() == 'not') {
                    tokenizer.next()
                    return new NotNode(parseFactor())
                }
                else {
                    // should replace token that we took somehow
                    return parseProperty()
                }
            }
            else {
                return null
            }
        }
    
        function parseProperty() {
            var propertyName = tokenizer.getCurrentToken().getValue()
            tokenizer.next()
    
            if(propertyName != 'group' && 
            propertyName != 'interface' &&
            propertyName != 'type' &&
            propertyName != 'id') {
                throw new Error('Parse error')
            }
            else if(tokenizer.getCurrentToken()) {
                if(tokenizer.getCurrentToken().getValue() == '=') {
                    tokenizer.next()
                    var propertyValue = tokenizer.getCurrentToken()
    
                    if(propertyValue instanceof StringToken) {
                        tokenizer.next()
                        return new StringCheckNode(propertyName, propertyValue.getStringValue())
                    }
                    else if(propertyValue.getValue() == '*') {
                        tokenizer.next()
                        return new WildcardCheckNode(propertyName)
                    }
                    else {
                        throw new Error('Parse error')
                    }
                }
                else {
                    throw new Error('Parse error')
                }
            }
            else {
                throw new Error('Parse error')
            }
        }
    
        tokenizer.next()
    
        if(!tokenizer.getCurrentToken()) {
            throw new Error('Parse error')
        }
    
        var predicate = parsePredicate()
    
        if(tokenizer.getCurrentToken()) {
            throw new Error('Parse error')
        }
        else {
            return predicate
        }
    }
}

class ASTNode {
    constructor(children) {
        this.children = children
    }
    
    getChildren() {
        return this.children
    }
    
    flatten() {
        // does nothing by default
    }
    
    toNormalizedString() {
        var copy = new SelectionParser(new SelectionTokenizer(this.toString())).parse()
        copy.flatten()
        return copy.toString()
    }
}

class CheckNode extends ASTNode {
    constructor(propertyName) {
        super([ ])
        this.propertyName = propertyName
    }
    
    getPropertyName() {
        return this.propertyName
    }
}

class StringCheckNode extends CheckNode {
    constructor(propertyName, propertyValue) {
        super(propertyName)
        this.propertyValue = propertyValue
    }
    
    getPropertyValue() {
        return this.propertyValue
    }
    
    toString() {
        return this.getPropertyName() + '="' + this.getPropertyValue() + '"'
    }
}

class WildcardCheckNode extends CheckNode {
    toString() {
        return this.getPropertyName() + '=*'
    }   
}

class OperatorNode extends ASTNode {
    
}

class UnaryOperatorNode extends OperatorNode {
    constructor(operand) {
        super([ operand ])
    }
    
    getOperand() {
        return this.getChildren()[0]
    }
}

class NotNode extends UnaryOperatorNode {
    flatten() {
        this.getOperand().flatten()
    }
    
    toString() {
        return '( not ' + this.getOperand().toString() + ' )'
    }
}

class BinaryOperatorNode extends OperatorNode {
    constructor(leftOperand, rightOperand) {
        super([ leftOperand, rightOperand ])
    }
    
    getLeftOperand() {
        return this.getChildren()[0]
    }
    
    getRightOperand() {
        return this.getChildren()[1]
    }
    
    static flatten(Type, instance) {
        var newChildren = [ ]

        instance.getLeftOperand().flatten()
        instance.getRightOperand().flatten()
    
        // if the child node is the same type of operation, it should be flattened.
        // (A and (B and C)) = (A and B and C)
        if(instance.getLeftOperand() instanceof Type) {
            newChildren.push.apply(newChildren, instance.getLeftOperand().getChildren())
        }
        else {
            newChildren.push(instance.getLeftOperand())
        }
    
        if(instance.getRightOperand() instanceof Type) {
            newChildren.push.apply(newChildren, instance.getRightOperand().getChildren())
        }
        else {
            newChildren.push(instance.getRightOperand())
        } 
    
        instance.children = newChildren
    }
    
    static toString(instance) {
        var operator = (instance instanceof AndNode)?'and':'or'

        return instance.getChildren().map(
            c => c.toString()
        ).sort().reduce(
            (previousValue, currentValue, index, array) => previousValue + ' ' + currentValue + ((index == array.length-1)?' )':' '+operator), 
            '('
        )
    }
}

class AndNode extends BinaryOperatorNode {
    flatten() {
        BinaryOperatorNode.flatten(AndNode, this)
    }
    
    toString() {
        return BinaryOperatorNode.toString(this)
    }
}

class OrNode extends BinaryOperatorNode {
    flatten() {
        BinaryOperatorNode.flatten(OrNode, this)
    }
    
    toString() {
        return BinaryOperatorNode.toString(this)
    }
}

const parseSelection = function(selectionString) {
    let parser = new SelectionParser(new SelectionTokenizer(selectionString))

    return parser.parse()
}

module.exports = {
    parse: parseSelection,
    Tokenizer: SelectionTokenizer,
    Token: Token,
    TerminalToken: TerminalToken,
    StringToken: StringToken,
    Parser: SelectionParser,
    ASTNode: ASTNode,
    CheckNode: CheckNode,
    StringCheckNode: StringCheckNode,
    WildcardCheckNode: WildcardCheckNode,
    OperatorNode: OperatorNode,
    UnaryOperatorNode: UnaryOperatorNode,
    NotNode: NotNode,
    BinaryOperatorNode: BinaryOperatorNode,
    AndNode: AndNode,
    OrNode: OrNode
}
