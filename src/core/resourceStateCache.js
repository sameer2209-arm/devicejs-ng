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

const StateCachePrefix = 'devicejs.resourcestates'

const CacheUpdateSchema = {
    type: 'array',
    items: {
        oneOf: [
            {
                type: 'object',
                properties: {
                    op: {
                        type: 'string',
                        pattern: '^set$'
                    },
                    resource: {
                        type: 'string',
                        minLength: 1
                    },
                    property: {
                        type: 'string',
                        minLength: 1
                    }
                },
                required: [ 'op', 'resource', 'property', 'value' ]
            },
            {
                type: 'object',
                properties: {
                    op: {
                        type: 'string',
                        pattern: '^delete$'
                    },
                    resource: {
                        type: 'string',
                        minLength: 1
                    }
                },
                required: [ 'op', 'resource' ]
            }
        ]
    }
}

const PointQuerySchema = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            resource: {
                type: 'string',
                minLength: 1
            },
            property: {
                type: 'string',
                minLength: 1
            }
        },
        required: [ 'resource' ]
    }
}

const CacheValueSchema = {
    type: 'object',
    properties: {
        timestamp: {
            type: 'integer',
            minimum: 0
        }
    },
    required: [ 'timestamp', 'value' ]
}

function base64(str) {
    return new Buffer(str).toString('base64')
}

function utf8(str) {
    return new Buffer(str, 'base64').toString()
}

class ResourceStateCache {
    constructor(options) {
        this.ddb = options.ddb
    }

    update(updates) {
        if(!validate(updates, CacheUpdateSchema).valid) {
            return Promise.reject('Invalid update submitted')
        }

        let batch = [ ]
        let timestamp = Date.now()
        let deleteAll = { }
        let p = Promise.resolve()

        for(let update of updates) {
            switch(update.op) {
            case 'set':
                batch.push({
                    type: 'put',
                    key: this._pointKey(update.resource, update.property),
                    value: JSON.stringify({ value: update.value, timestamp: timestamp }),
                    context: ''
                })
                break
            case 'delete':
                deleteAll[update.resource] = true
                break
            }
        }

        if(Object.keys(deleteAll).length > 0) {
            p = this.ddb.lww.getMatches(Object.keys(deleteAll).map(resource => this._pointKey(resource)), (error, result) => {
                if(error) {
                    return
                }

                batch.push({
                    type: 'delete',
                    key: result.key,
                    context: ''
                })
            })
        }

        return p.then(() => {
            if(batch.length == 0) {
                return Promise.resolve()
            }
    
            return this.ddb.lww.batch(batch)
        })
    }

    query(pointsQuery) {
        if(!validate(pointsQuery, PointQuerySchema).valid) {
            return Promise.reject('Invalid point query')
        }

        let keys = pointsQuery.map(point => this._pointKey(point.resource, point.property))
        let points = [ ]

        return this.ddb.lww.getMatches(keys, (error, result) => {
            if(error) {
                return
            }

            let point = result.key.substring((StateCachePrefix + '.').length).split('.').map(utf8).filter(str => str !== '')

            if(point.length != 2) {
                return
            }

            let value = JSON.parse(result.value)

            if(!validate(value, CacheValueSchema).valid) {
                return
            }

            points.push({
                resource: point[0],
                property: point[1],
                value: value.value,
                timestamp: value.timestamp
            })
        }).then(() => {
            return points
        })
    }

    _pointKey(resource, property) {
        if(resource && property) {
            return StateCachePrefix + '.' + base64(resource) + '.' + base64(property)
        }

        return StateCachePrefix + '.' + base64(resource) + '.'
    }
}

module.exports = ResourceStateCache