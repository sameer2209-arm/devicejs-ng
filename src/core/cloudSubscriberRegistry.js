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

const registry = require('./registry')

class CloudSubscriberRegistry extends registry.SubscriberRegistry {
    constructor(resourceIndex) {
        super(resourceIndex)
    }
    
    gc() {
        this.subscriberToSubscription = { }
        this.subscriptions = { }
        this.inputs = { }
    }
    
    subscribe(subscriptionID, graph, event, matchEventPrefix) {
        let subscriberID = 'cloud'
        
        if(this.subscriptions[subscriptionID]) {
            return subscriptionID
        }
        
        this.subscriberToSubscription[subscriberID] = this.subscriberToSubscription[subscriberID] || { }
        this.subscriberToSubscription[subscriberID][subscriptionID] = true
        this.subscriptions[subscriptionID] = { id: subscriptionID, graph: graph, event: event, prefix: matchEventPrefix, subscriberID: subscriberID }
            
        for(let sourceNodeID in graph.sources) {
            let parentNodeID = graph.sources[sourceNodeID].parent == null ? null : parseInt(graph.sources[sourceNodeID].parent)
            let inputString = graph.sources[sourceNodeID].node
            
            this.inputs[inputString] = this.inputs[inputString] || { }
            this.inputs[inputString][subscriptionID] = this.inputs[inputString][subscriptionID] || [ ]
            this.inputs[inputString][subscriptionID].push(parentNodeID)
        }
                    
        return subscriptionID
    }
    
    unsubscribe(subscriptionID) {
        return super.unsubscribe('cloud', subscriptionID)
    }
    
    cloudNeedsEvent(resourceID, event) {
        return this.getSubscribers(resourceID, event).then((subscribers) => {
            return 'cloud' in subscribers
        })
    }
}

module.exports = CloudSubscriberRegistry
