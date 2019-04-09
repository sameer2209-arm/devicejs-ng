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
const expect = require('expect.js')
const should = require('should')
const shouldPromised = require('should-promised')
const LinkStateTable = require('../src/core/router').LinkStateTable

describe('LinkStateTable', function() {
    describe('#diff', function() {
        it('should return any link state entries where the other link state table does not have that entry', function() {
            let linkStateTable1 = new LinkStateTable('node1')
            let linkStateTable2 = new LinkStateTable('node2')
            
            linkStateTable1.diff(linkStateTable2.getDigest()).should.be.eql(new LinkStateTable(new Map([
                [ 'node1', { neighbors: new Set(), sequenceNumber: 0 } ]
            ])))
            
            linkStateTable2.diff(linkStateTable1.getDigest()).should.be.eql(new LinkStateTable(new Map([
                [ 'node2', { neighbors: new Set(), sequenceNumber: 0 } ]
            ])))
        })
        
        it('should return any link state entries where the other link state table has that entry but its sequence number is lower', function() {
            let linkStateTable1 = new LinkStateTable('node1')
            let linkStateTable2 = new LinkStateTable('node2')
            
            linkStateTable2.linkUp('node1')
            
            linkStateTable1.diff(linkStateTable2.getDigest()).should.be.eql(new LinkStateTable(new Map([
                [ 'node1', { neighbors: new Set(), sequenceNumber: 0 } ]
            ])))
            
            linkStateTable2.diff(linkStateTable1.getDigest()).should.be.eql(new LinkStateTable(new Map([
                [ 'node2', { neighbors: new Set([ 'node1' ]), sequenceNumber: 1 } ]
            ])))
        })
    })
        
    describe('#merge', function() {
        it('', function() {
            let linkStateTable1 = new LinkStateTable('node1')
            let linkStateTable2 = new LinkStateTable('node2')
            
            linkStateTable1.linkUp('nodeA')
            linkStateTable1.linkUp('nodeB')
            linkStateTable1.linkUp('nodeC')
            linkStateTable2.linkUp('nodeD')
            linkStateTable2.linkUp('nodeE')
            linkStateTable2.linkUp('nodeF')
            
            linkStateTable2.merge(linkStateTable1.diff(linkStateTable2.getDigest())).should.be.eql(new LinkStateTable(new Map([
                [ 'node1', { neighbors: new Set([ 'nodeA', 'nodeB', 'nodeC' ]), sequenceNumber: 3 } ]
            ])))
            
            linkStateTable1.merge(linkStateTable2.diff(linkStateTable1.getDigest())).should.be.eql(new LinkStateTable(new Map([
                [ 'node2', { neighbors: new Set([ 'nodeD', 'nodeE', 'nodeF' ]), sequenceNumber: 3 } ]
            ])))
            
            linkStateTable1.getLinkStateMap().should.be.eql(new Map([
                [ 'node1', new Set([ 'nodeA', 'nodeB', 'nodeC' ]) ],
                [ 'node2', new Set([ 'nodeD', 'nodeE', 'nodeF' ]) ]
            ]))
            
            linkStateTable1.getLinkStateMap().should.be.eql(new Map([
                [ 'node1', new Set([ 'nodeA', 'nodeB', 'nodeC' ]) ],
                [ 'node2', new Set([ 'nodeD', 'nodeE', 'nodeF' ]) ]
            ]))
        })
    })
    
    describe('#getShortestPathTree', function() {
        it('', function() {
            let node1 = new LinkStateTable('node1')
            let node2 = new LinkStateTable('node2')
            let node3 = new LinkStateTable('node3')
            let node4 = new LinkStateTable('node4')
            
            node1.linkUp('node2')
            node2.linkUp('node1')
            node2.linkUp('node3')
            node3.linkUp('node2')
            node3.linkUp('node4')
            node4.linkUp('node3')
            
            // 1 and 2 form a link
            node2.merge(node1.diff(node2.getDigest()))
            node1.merge(node2.diff(node1.getDigest()))
            
            // 2 and 3 form a link
            node3.merge(node2.diff(node3.getDigest()))
            node1.merge(node2.merge(node3.diff(node2.getDigest())))
            
            // 3 and 4 form a link
            node4.merge(node3.diff(node4.getDigest()))
            node1.merge(node2.merge(node3.merge(node4.diff(node3.getDigest()))))
            
            node1.getLinkStateMap().should.be.eql(node2.getLinkStateMap())
            node2.getLinkStateMap().should.be.eql(node3.getLinkStateMap())
            node3.getLinkStateMap().should.be.eql(node4.getLinkStateMap())
            node4.getLinkStateMap().should.be.eql(new Map([
                [ 'node1', new Set([ 'node2' ]) ],
                [ 'node2', new Set([ 'node1', 'node3' ]) ],
                [ 'node3', new Set([ 'node2', 'node4' ]) ],
                [ 'node4', new Set([ 'node3' ]) ]
            ]))
            
            node1.getShortestPathTree().should.be.eql(new Map([
                [ 'node1', new Set([ 'node2' ]) ],
                [ 'node2', new Set([ 'node3' ]) ],
                [ 'node3', new Set([ 'node4' ]) ]
            ]))
            
            node2.getShortestPathTree().should.be.eql(new Map([
                [ 'node2', new Set([ 'node1', 'node3' ]) ],
                [ 'node3', new Set([ 'node4' ]) ]
            ]))
            
            node3.getShortestPathTree().should.be.eql(new Map([
                [ 'node3', new Set([ 'node2', 'node4' ]) ],
                [ 'node2', new Set([ 'node1' ]) ]
            ]))
        })
    })
    
    describe('#updateRoutingTable', function() {
        it('', function() {
            let node1 = new LinkStateTable('node1')
            let node2 = new LinkStateTable('node2')
            let node3 = new LinkStateTable('node3')
            let node4 = new LinkStateTable('node4')
            
            node1.linkUp('node2')
            node2.linkUp('node1')
            node2.linkUp('node3')
            node3.linkUp('node2')
            node3.linkUp('node4')
            node4.linkUp('node3')
            
            // 1 and 2 form a link
            node2.merge(node1.diff(node2.getDigest()))
            node1.merge(node2.diff(node1.getDigest()))
            
            // 2 and 3 form a link
            node3.merge(node2.diff(node3.getDigest()))
            node1.merge(node2.merge(node3.diff(node2.getDigest())))
            
            // 3 and 4 form a link
            node4.merge(node3.diff(node4.getDigest()))
            node1.merge(node2.merge(node3.merge(node4.diff(node3.getDigest()))))
            
            node1.getLinkStateMap().should.be.eql(node2.getLinkStateMap())
            node2.getLinkStateMap().should.be.eql(node3.getLinkStateMap())
            node3.getLinkStateMap().should.be.eql(node4.getLinkStateMap())
            
            let routingTable1 = new Map()
            let routingTable2 = new Map()
            let routingTable3 = new Map()
            let routingTable4 = new Map()
            
            node1.updateRoutingTable(routingTable1)
            node2.updateRoutingTable(routingTable2)
            node3.updateRoutingTable(routingTable3)
            node4.updateRoutingTable(routingTable4)

            routingTable1.should.be.eql(new Map([
                [ 'node2', 'node2' ],
                [ 'node3', 'node2' ],
                [ 'node4', 'node2' ]
            ]))
            
            routingTable2.should.be.eql(new Map([
                [ 'node1', 'node1' ],
                [ 'node3', 'node3' ],
                [ 'node4', 'node3' ]
            ]))
                    
            routingTable3.should.be.eql(new Map([
                [ 'node1', 'node2' ],
                [ 'node2', 'node2' ],
                [ 'node4', 'node4' ]
            ]))
            
            routingTable4.should.be.eql(new Map([
                [ 'node1', 'node3' ],
                [ 'node2', 'node3' ],
                [ 'node3', 'node3' ]
            ]))
        })
    })
    
    describe('#serialize+deserialize', function() {
        it('', function() {
            let node1 = new LinkStateTable('node1')
            let node2 = new LinkStateTable('node2')
            let node3 = new LinkStateTable('node3')
            let node4 = new LinkStateTable('node4')
            
            node1.linkUp('node2')
            node2.linkUp('node1')
            node2.linkUp('node3')
            node3.linkUp('node2')
            node3.linkUp('node4')
            node4.linkUp('node3')
            
            // 1 and 2 form a link
            node2.merge(node1.diff(node2.getDigest()))
            node1.merge(node2.diff(node1.getDigest()))
            
            // 2 and 3 form a link
            node3.merge(node2.diff(node3.getDigest()))
            node1.merge(node2.merge(node3.diff(node2.getDigest())))
            
            // 3 and 4 form a link
            node4.merge(node3.diff(node4.getDigest()))
            node1.merge(node2.merge(node3.merge(node4.diff(node3.getDigest()))))
            
            LinkStateTable.deserialize(LinkStateTable.serialize(node1)).should.be.eql(node1)
        })
    })
})