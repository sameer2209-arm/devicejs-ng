package clusterio_test
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
    . "devicedb/clusterio"
    . "devicedb/data"
    . "devicedb/routes"
)

type MockPartitionResolver struct {
    defaultPartitionResponse uint64
    defaultReplicaNodesResponse []uint64
    partitionCB func(partitioningKey string)
    replicaNodesCB func(partition uint64)
}

func NewMockPartitionResolver() *MockPartitionResolver {
    return &MockPartitionResolver{ }
}

func (partitionResolver *MockPartitionResolver) Partition(partitioningKey string) uint64 {
    if partitionResolver.partitionCB != nil {
        partitionResolver.partitionCB(partitioningKey)
    }

    return partitionResolver.defaultPartitionResponse
}

func (partitionResolver *MockPartitionResolver) ReplicaNodes(partition uint64) []uint64 {
    if partitionResolver.replicaNodesCB != nil {
        partitionResolver.replicaNodesCB(partition)
    }

    return partitionResolver.defaultReplicaNodesResponse
}

type MockNodeClient struct {
    defaultBatchPatch map[string]*SiblingSet
    defaultBatchError error
    defaultGetResponse []*SiblingSet
    defaultGetResponseError error
    defaultGetMatchesResponse SiblingSetIterator
    defaultGetMatchesResponseError error
    mergeCB func(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, patch map[string]*SiblingSet, broadcastToRelays bool) error
    batchCB func(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, updateBatch *UpdateBatch) (map[string]*SiblingSet, error)
    getCB func(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, keys [][]byte) ([]*SiblingSet, error)
    getMatchesCB func(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, keys [][]byte) (SiblingSetIterator, error)
}

func NewMockNodeClient() *MockNodeClient {
    return &MockNodeClient{ }
}

func (nodeClient *MockNodeClient) Merge(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, patch map[string]*SiblingSet, broadcastToRelays bool) error {
    if nodeClient.mergeCB != nil {
        return nodeClient.mergeCB(ctx, nodeID, partition, siteID, bucket, patch, broadcastToRelays)
    }
    
    return nil
}

func (nodeClient *MockNodeClient) Batch(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, updateBatch *UpdateBatch) (map[string]*SiblingSet, error) {
    if nodeClient.batchCB != nil {
        return nodeClient.batchCB(ctx, nodeID, partition, siteID, bucket, updateBatch)
    }

    return nodeClient.defaultBatchPatch, nodeClient.defaultBatchError
}

func (nodeClient *MockNodeClient) Get(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, keys [][]byte) ([]*SiblingSet, error) {
    if nodeClient.getCB != nil {
        return nodeClient.getCB(ctx, nodeID, partition, siteID, bucket, keys)
    }

    return nodeClient.defaultGetResponse, nodeClient.defaultGetResponseError
}

func (nodeClient *MockNodeClient) GetMatches(ctx context.Context, nodeID uint64, partition uint64, siteID string, bucket string, keys [][]byte) (SiblingSetIterator, error) {
    if nodeClient.getMatchesCB != nil {
        return nodeClient.getMatchesCB(ctx, nodeID, partition, siteID, bucket, keys)
    }

    return nodeClient.defaultGetMatchesResponse, nodeClient.defaultGetMatchesResponseError
}

func (nodeClient *MockNodeClient) RelayStatus(ctx context.Context, nodeID uint64, siteID string, relayID string) (RelayStatus, error) {
    return RelayStatus{}, nil
}

func (nodeClient *MockNodeClient) LocalNodeID() uint64 {
    return 0
}

type MockNodeReadRepairer struct {
    beginRepairCB func(partition uint64, siteID string, bucket string, readMerger NodeReadMerger)
    stopRepairsCB func()
}

func NewMockNodeReadRepairer() *MockNodeReadRepairer {
    return &MockNodeReadRepairer{
    }
}

func (readRepairer *MockNodeReadRepairer) BeginRepair(partition uint64, siteID string, bucket string, readMerger NodeReadMerger) {
    if readRepairer.beginRepairCB != nil {
        readRepairer.beginRepairCB(partition, siteID, bucket, readMerger)
    }
}

func (readRepairer *MockNodeReadRepairer) StopRepairs() {
    if readRepairer.stopRepairsCB != nil {
        readRepairer.stopRepairsCB()
    }
}

type siblingSetIteratorEntry struct {
    Prefix []byte
    Key []byte
    Value *SiblingSet
    Error error
}

type MemorySiblingSetIterator struct {
    entries []*siblingSetIteratorEntry
    nextEntry *siblingSetIteratorEntry
}

func NewMemorySiblingSetIterator() *MemorySiblingSetIterator {
    return &MemorySiblingSetIterator{
        entries: make([]*siblingSetIteratorEntry, 0),
    }
}

func (iter *MemorySiblingSetIterator) AppendNext(prefix []byte, key []byte, value *SiblingSet, err error) {
    iter.entries = append(iter.entries, &siblingSetIteratorEntry{
        Prefix: prefix,
        Key: key,
        Value: value,
        Error: err,
    })
}

func (iter *MemorySiblingSetIterator) Next() bool {
    iter.nextEntry = nil

    if len(iter.entries) == 0 {
        return false
    }

    iter.nextEntry = iter.entries[0]
    iter.entries = iter.entries[1:]

    if iter.nextEntry.Error != nil {
        return false
    }

    return true
}

func (iter *MemorySiblingSetIterator) Prefix() []byte {
    return iter.nextEntry.Prefix
}

func (iter *MemorySiblingSetIterator) Key() []byte {
    return iter.nextEntry.Key
}

func (iter *MemorySiblingSetIterator) Value() *SiblingSet {
    return iter.nextEntry.Value
}

func (iter *MemorySiblingSetIterator) LocalVersion() uint64 {
    return 0
}

func (iter *MemorySiblingSetIterator) Release() {
}

func (iter *MemorySiblingSetIterator) Error() error {
    if iter.nextEntry == nil {
        return nil
    }

    return iter.nextEntry.Error
}