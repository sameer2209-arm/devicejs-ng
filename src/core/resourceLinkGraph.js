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

const validate = require('jsonschema').validate

const LinkGraphDDBPrefix = 'devicejs.resourcegraph'

const GraphUpdateSchema = {
    oneOf: [
        {
            type: 'object',
            properties: {
                op: {
                    type: 'string',
                    pattern: '^link$'
                },
                source: {
                    type: 'string',
                    minLength: 1
                },
                dest: {
                    type: 'string',
                    minLength: 1
                },
                label: {
                    type: 'string'
                }
            },
            required: [ 'op', 'source', 'dest', 'label' ]
        },
        {
            type: 'object',
            properties: {
                op: {
                    type: 'string',
                    pattern: '^unlink$'
                },
                source: {
                    type: 'string',
                    minLength: 1
                },
                dest: {
                    type: 'string',
                    minLength: 1
                }
            },
            required: [ 'op', 'source', 'dest' ]
        },
        {
            type: 'object',
            properties: {
                op: {
                    type: 'string',
                    pattern: '^unlinkAll$'
                },
                node: {
                    type: 'string',
                    minLength: 1
                }
            },
            required: [ 'op', 'node' ]
        }
    ]
}

function base64(str) {
    return new Buffer(str).toString('base64')
}

function utf8(str) {
    return new Buffer(str, 'base64').toString()
}

class LinkGraph {
    constructor(options) {
        this.ddb = options.ddb
    }

    update(updates) {
        // add/remove links in a batch update
        // Update: { op: 'link|unlink', source: 'device1', dest: 'device2', label: 'parent' }
        // Update: { op: 'unlinkAll', node: 'device1' }
        if(!Array.isArray(updates)) {
            return Promise.reject(new Error('First argument is not an array'))
        }

        let batch = [ ]
        let unlinkedAllResources = { }
        let p = Promise.resolve()

        for(let update of updates) {
            if(!validate(update, GraphUpdateSchema).valid) {
                continue
            }

            switch(update.op) {
            case 'link':
                batch.push({ type: 'put', key: this._edgeKey(update.source, update.dest), value: update.label, context: '' })
                break
            case 'unlink':
                batch.push({ type: 'delete', key: this._edgeKey(update.source, update.dest), context: '' })
                break
            case 'unlinkAll':
                unlinkedAllResources[update.node] = true
                break
            }
        }

        if(Object.keys(unlinkedAllResources).length > 0) {
            p = this.ddb.lww.getMatches(LinkGraphDDBPrefix + '.', (error, result) => {
                if(error) {
                    return
                }

                let edge = result.key.substring((LinkGraphDDBPrefix + '.').length).split('.').map(utf8).filter(str => str !== '')

                if(edge.length != 2) {
                    return
                }

                // check if the source or destination of this edge is a node specified
                // in one of the unlinkAll instructions
                if(unlinkedAllResources[edge[0]] || unlinkedAllResources[edge[1]]) {
                    batch.push({ type: 'delete', key: result.key, context: '' })
                }
            })
        }

        return p.then(() => {
            if(batch.length > 0) {
                return this.ddb.lww.batch(batch)
            }

            return Promise.resolve()
        })
    }

    edges(resources) {
        // return the links from these resources
        let keys = resources.map(this._edgePrefix)
        let edges = { }

        return this.ddb.lww.getMatches(keys, (error, result) => {
            if(error) {
                return
            }

            let edge = result.key.substring((LinkGraphDDBPrefix + '.').length).split('.').map(utf8).filter(str => str !== '')

            if(edge.length != 2) {
                return
            }

            edges[edge[0]] = edges[edge[0]] || { }
            edges[edge[0]][edge[1]] = result.value || ''
        }).then(() => {
            let e = [ ]

            for(let source in edges) {
                for(let dest in edges[source]) {
                    e.push({ source: source, dest: dest, label: edges[source][dest] })
                }
            }

            return e
        })
    }

    _edgeKey(source, dest) {
        return LinkGraphDDBPrefix + '.' + base64(source) + '.' + base64(dest)
    }

    _edgePrefix(source) {
        return LinkGraphDDBPrefix + '.' + base64(source) + '.'
    }
}

LinkGraph.Schema = GraphUpdateSchema

module.exports = LinkGraph