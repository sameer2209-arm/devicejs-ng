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

var path = require('path');

var TopicMap = function() {
    this._rootNode = { children: { }, clients: { } };
    this._clientSubscriptionMap = { };
};

TopicMap.prototype.getPublishSet = function(topicString) {
    var topic = this._parseTopicString(topicString);
    var publishSet = { };
    var nodeQueue = [ [ this._rootNode, 0 ] ];

    while(nodeQueue.length != 0) {
        var task = nodeQueue.shift();
        var node = task[0];
        var topicIndex = task[1];

        if(topicIndex == topic.length) {
            Object.keys(node.clients).forEach(function(clientID) {
                publishSet[clientID] = true;
            });

            if(node.children['#']) {
                nodeQueue.push([ node.children['#'], topic.length ]);
            }
        }
        else {
            if(node.children['+']) {
                nodeQueue.push([ node.children['+'], topicIndex+1 ]);
            }

            if(node.children['#']) {
                // skip the rest of the path. it doesn't matter
                nodeQueue.push([ node.children['#'], topic.length ]);
            }

            if(node.children[topic[topicIndex]]) {
                // follow the topic path
                nodeQueue.push([ node.children[topic[topicIndex]], topicIndex+1 ]);
            }
        }
    }

    return publishSet;
};

// should return set that encompasses all topics that are subscribed to
TopicMap.prototype.getTopics = function() {
    var topics = { };
    var nodeQueue = [ [ this._rootNode, '' ] ];

    while(nodeQueue.length != 0) {
        var task = nodeQueue.shift();
        var node = task[0];
        var topicString = task[1];

        if(Object.keys(node.children).length == 0 && 
           Object.keys(node.clients).length != 0 && 
           node != this._rootNode) {
            topics[topicString.substring(1)] = true;
        }
        else {
            Object.keys(node.children).forEach(function(subtopic) {
                if(node == this._rootNode) {
                    nodeQueue.push([ node.children[subtopic], subtopic ]);
                }
                else {
                    nodeQueue.push([ node.children[subtopic], topicString + '/' + subtopic ]);
                }
            });
        }
    }

    return topics;
};

TopicMap.prototype._parseTopicString = function(topicString) {
    var topic = topicString.split('/');

    topic.forEach(function(subtopic, index) {
        if(subtopic === '#' && topic.length != index+1) {
            throw new Error('Invalid topic string');
        }
    });

    return topic;
};

TopicMap.prototype.addSubscription = function(topicString, clientID) {
    var topic = this._parseTopicString(topicString);
    var node = this._rootNode;

    for(var i=0;i<topic.length;i++) {
        node.children[topic[i]] = node.children[topic[i]] || { children: { }, clients: { } };
        node = node.children[topic[i]];
    }
        
    this._clientSubscriptionMap[clientID] = this._clientSubscriptionMap[clientID] || { };
    this._clientSubscriptionMap[clientID][topicString] = true;
    node.clients[clientID] = true;
};

TopicMap.prototype.removeSubscription = function(topicString, clientID) {
    var topic = this._parseTopicString(topicString);
    var node = this._rootNode;

    for(var i=0;i<topic.length;i++) {
        node = node.children[topic[i]] || { clients: { }, children: { } };
    }

    delete node.clients[clientID];
};

TopicMap.prototype.removeClient = function(clientID) {
    var node = this._rootNode;

    if(this._clientSubscriptionMap[clientID]) {
        Object.keys(this._clientSubscriptionMap[clientID]).forEach(function(topicString) {
            this.removeSubscription(topicString, clientID);
        }.bind(this));
    }
};

module.exports = TopicMap;
