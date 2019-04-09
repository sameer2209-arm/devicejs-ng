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

var util = require('util');
var registry = require('./registry');
var ddb = require('../runtime/devicedb')({ });
var LRU = require('lru-cache');

var RESOURCE_INDEX_KEY_PREFIX = 'devicejs.core.resourceIndex';
var DEFAULT_CACHE_SIZE = 1000
var DEFAULT_CACHE_TTL = 60*1000*10

function toFullKey(k) {
    return RESOURCE_INDEX_KEY_PREFIX + '.' + k;
}

function cacheKey1(keyType, keyValue) {
    keyValue = keyValue || ''

    return '1-'+keyType+'-'+keyValue
}

function cacheKey2(resourceID) {
    return '2-'+resourceID
}

var ResourceIndex = function(ddb, resourceGroupTree) {
    this._ddb = ddb;
    this._resourceGroupTree = resourceGroupTree;
    this._cache = LRU({ max: DEFAULT_CACHE_SIZE, maxAge: DEFAULT_CACHE_TTL });
};

util.inherits(ResourceIndex, registry.ResourceIndex);

ResourceIndex.prototype.clearCache = function() {
    this._cache.reset();
};

ResourceIndex.prototype.getResources = function(keyType, keyValue) {
    var self = this;
    var resourceIDSet = { };
    
    function getAllResources() {
        function next(error, result) {
            if(result.siblings.length == 0) {
                return;
            }

            var resourceID = ddb.decodeKey(result.key.substring(result.prefix.length).split('.')[0]);
            
            resourceIDSet[resourceID] = true;
        }
        
        return self._ddb.shared.getMatches(toFullKey('id.'), next).then(function(resources) {
            return resourceIDSet;
        })
    }

    let cached = this._cache.get(cacheKey1(keyType, keyValue))
    
    if(cached) {
        return Promise.resolve(cached)
    }

    let result
    
    if(arguments.length == 0) {
        result = getAllResources();
    }
    else if(arguments.length == 1) {
        result = new Promise(function(resolve, reject) {
            if(keyType == 'group') {
                resolve(self._resourceGroupTree.listGroup())
            }
            else if(keyType == 'id' || keyType == 'type' || keyType == 'interface') {
                resolve(getAllResources());
            }
            else {
                reject(new Error('Invalid key type'));
            }
        });
    }
    else {
        result = new Promise(function(resolve, reject) {
            if(keyType == 'group') {
                resolve(self._resourceGroupTree.listGroup(keyValue))
            }
            else if(keyType == 'id' || keyType == 'type' || keyType == 'interface') {
                var set = { };
                
                function next(error, result) {
                    if(result.siblings.length == 0) {
                        return;
                    }

                    var resourceID = ddb.decodeKey(result.key.substring(result.prefix.length));
                    
                    set[resourceID] = true;
                }
                
                self._ddb.shared.getMatches(toFullKey(keyType+'.'+ddb.encodeKey(keyValue)+'.'), next).then(function() {
                    resolve(set);
                })
            }
            else {
                reject(new Error('Invalid key type'));
            }
        }).then(function(set) {
            return set;
        }, function(error) {
            if(/No such key/.test(error.value)) {
                return { };
            }
            else {
                throw error;
            }
        });
    }
    
    return result.then(function(set) {
        self._cache.set(cacheKey1(keyType, keyValue), set)
        
        return set
    });
};

ResourceIndex.prototype.getResourceProperties = function(resourceID) {
    var self = this;
    var key = toFullKey('id.'+ddb.encodeKey(resourceID)+'.'+ddb.encodeKey(resourceID))
    var cached = this._cache.get(cacheKey2(resourceID))
    
    if(cached) {
        return Promise.resolve(cached)
    }
    
    return this._ddb.shared.get(key).then(function(idValue) {
        var mergedValue = null
        
        if(idValue != null && !(idValue instanceof Error)) {
            mergedValue = mergeSiblings(idValue.siblings)
            self._cache.set(cacheKey2(resourceID), mergedValue)
        }
        else {
            // resource does not exist
            self._cache.del(cacheKey2(resourceID))
        }
        
        return mergedValue
    })
};

function mergeSiblingGroups(siblings) {
    var groups = { }
    
    for(var sibling of siblings) {
        try {
            var parsed = JSON.parse(sibling)
            
            for(var groupName in parsed.groups) {
                groups[groupName] = true
            }
        }
        catch(error) {
            
        }
    }
    
    return groups
}

function mergeSiblings(siblings) {
    var idValue = { groups: { } }
    
    for(var sibling of siblings) {
        try {
            var parsed = JSON.parse(sibling)
           
            idValue.type = parsed.type
            idValue.interfaces = parsed.interfaces
            
            for(var groupName in parsed.groups) {
                idValue.groups[groupName] = true
            }
        }
        catch(error) {
        }
    }
    
    if(typeof idValue.type !== 'string' || !Array.isArray(idValue.interfaces)) {
        idValue = null
    }
    
    return idValue
}

ResourceIndex.prototype.addResource = function(resource) {
    var self = this;
    var keys = [ ];
    
    keys.push(toFullKey('id.'+ddb.encodeKey(resource.id)+'.'+ddb.encodeKey(resource.id)));
    keys.push(toFullKey('type.'+ddb.encodeKey(resource.type)+'.'+ddb.encodeKey(resource.id)));
    
    resource.interfaces.forEach(function(_interface) {
        keys.push(toFullKey('interface.'+ddb.encodeKey(_interface)+'.'+ddb.encodeKey(resource.id)));
    });
    
    return this._ddb.shared.get(keys).then(function(values) {
        var update = [ ];
        var idValue = { 
            type: resource.type,
            interfaces: resource.interfaces
        }
        
        if(values[0] == null || values[0] instanceof Error) {
            idValue.groups = { }
        }
        else {
            idValue.groups = mergeSiblingGroups(values[0].siblings)
        }
        
        update.push({ type: 'put', key: keys[0], context: values[0] ? values[0].context : '', value: JSON.stringify(idValue) });
        update.push({ type: 'put', key: keys[1], context: values[1] ? values[1].context : '', value: '' });
        
        for(var i = 2; i < values.length; i += 1) {
            update.push({ type: 'put', key: keys[i], context: values[i] ? values[i].context : '', value: '' });
        }
        
        return self._ddb.shared.batch(update);
    }).then(function() {
        resource.interfaces.forEach(function(_interface) {
            self._cache.del(cacheKey1('interface', _interface));
        })

        self._cache.del(cacheKey1('id', resource.id));
        self._cache.del(cacheKey1('type', resource.type));
        self._cache.del(cacheKey1('id'));
        self._cache.del(cacheKey1('type'));
        self._cache.del(cacheKey1('group'));
        self._cache.del(cacheKey1('interface'));
        self._cache.del(cacheKey2(resource.id));
    });
};

ResourceIndex.prototype.removeResource = function(resourceID) {
    var self = this;
    var groups = { };
    var keys = [ 
        toFullKey('id.'+ddb.encodeKey(resourceID)+'.'+ddb.encodeKey(resourceID))
    ];
    
    //this._cache.del(cacheKey1('id', resourceID))
    //this._cache.del(cacheKey2(resourceID));

    return this._ddb.shared.get(toFullKey('id.'+ddb.encodeKey(resourceID)+'.'+ddb.encodeKey(resourceID))).then(function(result) {
        if(result == null || result.siblings.length == 0) {
            return;
        }

        for(var i = 0; i < result.siblings.length; i += 1) {
            try {
                var idValue = JSON.parse(result.siblings[i]);

                //self._cache.del(cacheKey1('type', idValue.type))
                keys.push(toFullKey('type.'+ddb.encodeKey(idValue.type)+'.'+ddb.encodeKey(resourceID)));

                if(Array.isArray(idValue.interfaces)) {
                    for(var i = 0; i < idValue.interfaces.length; i += 1) {
                        //self._cache.del(cacheKey1('interface', idValue.interfaces[i]))
                        keys.push(toFullKey('interface.'+ddb.encodeKey(idValue.interfaces[i])+'.'+ddb.encodeKey(resourceID)));
                    }
                }

                if(idValue.groups && typeof idValue.groups == 'object') {
                    for(var groupName in idValue.groups) {
                        groups[groupName] = true;
                    }
                }
            }
            catch(error) {
            }
        }
    }).then(function() {
        var update = [ ];
        var promises = [ ];

        for(var i = 0; i < keys.length; i += 1) {
            update.push({ type: 'delete', key: keys[i], context: '' });
        }

        promises.push(self._ddb.shared.batch(update));

        for(var groupName in groups) {
            promises.push(self._resourceGroupTree.leaveGroup(resourceID, groupName));
        }

        return Promise.all(promises);
    }).then(function() {
        self.clearCache()
    })
};

ResourceIndex.prototype.createGroup = function(groupName) {
    return this._resourceGroupTree.createGroup(groupName)
};

ResourceIndex.prototype._clearGroupCache = function(groupName, clearParentGroups, clearSubGroups) {
    // invalidate cache entries for this group and any sub-groups
    if(clearSubGroups) {
        this._cache.forEach((value, key) => {
            if(key.startsWith(cacheKey1('group', groupName))) {
                this._cache.del(key);
            }
        });
    }
    
    if(clearParentGroups) {
        let groups = groupName.split('/').map((groupComponent, index, groups) => groups.slice(0, index+1).join('/'))
        
        for(let group of groups) {
            this._cache.del(cacheKey1('group', group));
        }
    }
};

ResourceIndex.prototype.deleteGroup = function(groupName) {
    var self = this;
    var keys;
    var values;
    var resourceIDs;
    var cleanup;
    
    return this._resourceGroupTree.listGroup(groupName).then(function(resourceSet) {
        cleanup = function() {
            for(let resourceID in resourceSet) {
                self._cache.del(cacheKey2(resourceID));
            }
        }
        
        keys = Object.keys(resourceSet).map(resourceID => toFullKey('id.'+ddb.encodeKey(resourceID)+'.'+ddb.encodeKey(resourceID)))
        
        return self._ddb.shared.get(keys)
    }).then(function(_values) {
        values = _values
        return values.map(value => (value == null || value instanceof Error) ? null : mergeSiblings(value.siblings))
    }).then(function(parsedValues) {
        var update = [ ];
        
        for(var i = 0; i < parsedValues.length; i += 1) {
            if(parsedValues[i] != null) {
                delete parsedValues[i].groups[groupName]
                
                update.push({ type: 'put', key: keys[i], value: JSON.stringify(parsedValues[i]), context: values[i].context  })
            }
        }
        
        return self._ddb.shared.batch(update)
    }).then(function() {
        return self._resourceGroupTree.deleteGroup(groupName)
    }).then(function() {
        cleanup()
        self._clearGroupCache(groupName, true, true);
    })
};

ResourceIndex.prototype.joinGroup = function(resourceID, groupName) {
    var self = this;
    var key = toFullKey('id.'+ddb.encodeKey(resourceID)+'.'+ddb.encodeKey(resourceID))
    
    return this._ddb.shared.get(key).then(function(idValue) {
        var mergedValue = null
        
        if(idValue != null || !(idValue instanceof Error)) {
            mergedValue = mergeSiblings(idValue.siblings)
        }
        else {
            // should have no effect if the resource does not exist
            throw new Error('no such resource')
        }
        
        if(mergedValue == null) {
            throw new Error('data format error')
        }
        
        mergedValue.groups[groupName] = true
        
        return self._ddb.shared.put(key, JSON.stringify(mergedValue), idValue.context)
    }).then(function() {
        return self._resourceGroupTree.joinGroup(resourceID, groupName)
    }).then(function() {
        self._cache.del(cacheKey2(resourceID));
        self._clearGroupCache(groupName, true, true);
    })
};

ResourceIndex.prototype.leaveGroup = function(resourceID, groupName) {
    var self = this;
    var key = toFullKey('id.'+ddb.encodeKey(resourceID)+'.'+ddb.encodeKey(resourceID))
    
    return this._ddb.shared.get(key).then(function(idValue) {
        var mergedValue = null
        
        if(idValue != null || !(idValue instanceof Error)) {
            mergedValue = mergeSiblings(idValue.siblings)
        }
        else {
            // resource does not exist
            throw new Error('no such resource')
        }
        
        if(mergedValue == null) {
            throw new Error('data format error')
        }
        
        delete mergedValue.groups[groupName]
        
        return self._ddb.shared.put(key, JSON.stringify(mergedValue), idValue.context)
    }).then(function() {
        return self._resourceGroupTree.leaveGroup(resourceID, groupName)
    }, function(error) {
        return self._resourceGroupTree.leaveGroup(resourceID, groupName).then(function() {
        }, function() {
            throw error
        })
    }).then(function() {
        self._cache.del(cacheKey2(resourceID));
        self._clearGroupCache(groupName, true, true);
    })
};

module.exports = ResourceIndex;
