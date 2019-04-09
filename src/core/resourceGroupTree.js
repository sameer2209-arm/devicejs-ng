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

var ddb = require('../runtime/devicedb')({ });
var RESOURCE_GROUPS_PREFIX = 'devicejs.core.resourceGroups';

function toFullKey(k) {
    return RESOURCE_GROUPS_PREFIX + '.' + k;
}

function createResourceGroupPath(resourceGroup) {
    return resourceGroup;
}

function mergeValueSiblings(value) {
    var mergedSiblings = { };
        
    if(value) {
        for(var i = 0; i < value.siblings.length; i += 1) {
            try {
                var parsedSibling = JSON.parse(value.siblings[i]);
                
                if(typeof parsedSibling === 'object' && parsedSibling !== null) {
                    for(var resourceID in parsedSibling) {
                        mergedSiblings[resourceID] = true;
                    }
                }
            }
            catch(error) {
                
            }
        }
    }
    
    return mergedSiblings;
}

var ResourceGroupTree = function(ddb) {
    this._ddb = ddb;
};

ResourceGroupTree.prototype.createGroup = function(resourceGroup) {
    var self = this;
    
    return this._ddb.shared.get(toFullKey('root/'+resourceGroup)).then(function(value) {
        var context = value == null ? '' : value.context;
        var mergedSiblings = mergeValueSiblings(value);
        
        return self._ddb.shared.put(toFullKey('root/'+resourceGroup), JSON.stringify(mergedSiblings), context);
    });
};

ResourceGroupTree.prototype.deleteGroup = function(resourceGroup) {
    var self = this;
    var resourceGroupComponents = resourceGroup.split('/');
    var parentGroup = resourceGroupComponents.slice(0, resourceGroupComponents.length-1).join('/')
    var childrenDeletes = [ ];
    
    childrenDeletes.push({
        type: 'delete',
        key: toFullKey('root/'+resourceGroup),
        context: ''
    })
    
    function next(error, result) {
        childrenDeletes.push({
            type: 'delete',
            key: result.key,
            context: result.context
        });
    }
    
    return this._ddb.shared.getMatches(toFullKey('root/'+resourceGroup+'/'), next).then(function() {
        if(childrenDeletes.length > 0) {
            if(parentGroup) {
                return self.createGroup(parentGroup).then(function() {
                    return self._ddb.shared.batch(childrenDeletes);
                });
            }
            else {
                return self._ddb.shared.batch(childrenDeletes);
            }
        }
    });
};

ResourceGroupTree.prototype._updateGroup = function(resourceID, resourceGroup, updateStrategy, skipIfNull) {
    var self = this;
    
    if(typeof resourceGroup !== 'string') {
        resourceGroup = ''
    }
    
    var groupKey = toFullKey('root' + (resourceGroup == ''?'':'/') + resourceGroup)
    
    return this._ddb.shared.get(groupKey).then(function(value) {
        if(value == null && skipIfNull) {
            return;
        }
        else {
            var context = value == null ? '' : value.context;
            var mergedSiblings = mergeValueSiblings(value);
            
            updateStrategy(mergedSiblings);
            
            return self._ddb.shared.put(groupKey, JSON.stringify(mergedSiblings), context);
        }
    });
};

ResourceGroupTree.prototype.joinGroup = function(resourceID, resourceGroup) {
    return this._updateGroup(resourceID, resourceGroup, function(resources) {
        resources[ddb.encodeKey(resourceID)] = true;
    }, false);
};

ResourceGroupTree.prototype.leaveGroup = function(resourceID, resourceGroup) {
    return this._updateGroup(resourceID, resourceGroup, function(resources) {
        delete resources[ddb.encodeKey(resourceID)];
    }, true);
};

ResourceGroupTree.prototype.getGroup = function(resourceGroup) {
    var rootGroup = { children: { }, resources: { } };
    var childCount = 0;
    
    function next(error, result) {
        var subGroupPath = result.key.substring(result.prefix.length).split('/');
        var group = rootGroup;
        
        if(result.siblings.length > 0) {
            childCount += 1;
            
            for(var i = 0; i < subGroupPath.length; i += 1) {
                if(subGroupPath[i] != '') {
                    group = group.children[subGroupPath[i]] = group.children[subGroupPath[i]] || { children: { }, resources: { } };
                }
            }
            
            var mergedSiblings = mergeValueSiblings(result);
            
            for(var resourceID in mergedSiblings) {
                group.resources[ddb.decodeKey(resourceID)] = { };
            }
        }
    }
    
    if(typeof resourceGroup !== 'string') {
        resourceGroup = '';
    }
    
    var groupKey = toFullKey('root' + (resourceGroup == ''?'':'/') + resourceGroup);
    
    return this._ddb.shared.getMatches(groupKey, next).then(function() {
        if(resourceGroup.length > 0 && childCount == 0) {
            throw new Error('No such group');
        }
        else {
            return rootGroup;
        }
    });
};

ResourceGroupTree.prototype.listGroup = function(resourceGroup) {
    function flattenResources(group, resourceList) {
        if(group.resources) {
            Object.keys(group.resources).forEach(function(resourceID) {
                resourceList[resourceID] = true;
            });
        }

        if(group.children) {
            Object.keys(group.children).forEach(function(childGroupName) {
                var childGroup = group.children[childGroupName];

                flattenResources(childGroup, resourceList);
            });
        }
    }

    var set = { };
    return this.getGroup.apply(this, arguments).then(function(group) {
        flattenResources(group, set);

        return set;
    }, function(error) {
        if(/No such group/.test(error.message)) {
            return { };
        }
        else {
            throw error;
        }
    });
};

module.exports = ResourceGroupTree;
