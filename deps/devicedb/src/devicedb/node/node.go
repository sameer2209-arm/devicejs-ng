package node
//
 // Copyright (c) 2019 ARM Limited.
 //
 // SPDX-License-Identifier: MIT
 //
 // Permission is hereby granted, free of charge, to any person obtaining a copy
 // of this software and associated documentation files (the "Software"), to
 // deal in the Software without restriction, including without limitation the
 // rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 // sell copies of the Software, and to permit persons to whom the Software is
 // furnished to do so, subject to the following conditions:
 //
 // The above copyright notice and this permission notice shall be included in all
 // copies or substantial portions of the Software.
 //
 // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 // AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 // LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 // OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 // SOFTWARE.
 //


import (
    "context"
    
    . "devicedb/bucket"
    . "devicedb/data"
    . "devicedb/routes"
)

// A Node coordinates interactions between
// internal node components
type Node interface {
    // Start up the node. 
    // Case 1) This node is not yet part of a cluster 
    //   It will use the initialization options to figure out whether it should start a new cluster or join an existing one.
    // Case 2) This node is part of a cluster and the decomissioning flag is not set
    //   It should start up and resume its operations as a member of its cluster. Start will run until Stop is called,
    //   in which case it will return nil, or until the node is removed from the cluster in which case it returns ERemoved
    //   or EDecommissioned
    // Case 3) This node is part of a cluster and the decomissioning flag is set
    //   It should start up in decomissioning mode, allowing only operations
    //   which transfer its partitions to new owners. After it has been removed from the cluster
    //   Start returns EDecomissioned or ERemoved
    // EDecomissioned is returned when the node was removed from the cluster after successfully transferring away all its
    // data to other nodes in the cluster
    // ERemoved is returned when the node was removed from the cluster before successfully transferring away all its data
    // to other nodes in the cluster
    ID() uint64
    Start(options NodeInitializationOptions) error
    // Shut down the node
    Stop()
    Batch(ctx context.Context, partition uint64, siteID string, bucket string, updateBatch *UpdateBatch) (map[string]*SiblingSet, error)
    Merge(ctx context.Context, partition uint64, siteID string, bucket string, patch map[string]*SiblingSet, broadcastToRelays bool) error
    Get(ctx context.Context, partition uint64, siteID string, bucket string, keys [][]byte) ([]*SiblingSet, error)
    GetMatches(ctx context.Context, partition uint64, siteID string, bucket string, keys [][]byte) (SiblingSetIterator, error)
    RelayStatus(relayID string) (RelayStatus, error)
}
