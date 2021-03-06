package builtin
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
    . "devicedb/bucket"
    . "devicedb/storage"
    . "devicedb/resolver/strategies"
)

type DefaultBucket struct {
    Store
}

func NewDefaultBucket(nodeID string, storageDriver StorageDriver, merkleDepth uint8) (*DefaultBucket, error) {
    defaultBucket := &DefaultBucket{}

    err := defaultBucket.Initialize(nodeID, storageDriver, merkleDepth, &MultiValue{})

    if err != nil {
        return nil, err
    }

    return defaultBucket, nil
}

func (defaultBucket *DefaultBucket) Name() string {
    return "default"
}

func (defaultBucket *DefaultBucket) ShouldReplicateOutgoing(peerID string) bool {
    return true
}

func (defaultBucket *DefaultBucket) ShouldReplicateIncoming(peerID string) bool {
    return true
}

func (defaultBucket *DefaultBucket) ShouldAcceptWrites(clientID string) bool {
    return true
}

func (defaultBucket *DefaultBucket) ShouldAcceptReads(clientID string) bool {
    return true
}