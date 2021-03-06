package clusterio
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
    "sort"

    . "devicedb/data"
)

type SiblingSetMergeIterator struct {
    readMerger NodeReadMerger
    keys [][]string
    prefixes []string
    keySet map[string]bool
    prefixIndexes map[string]int
    currentPrefixIndex int
    currentKeyIndex int
}

func NewSiblingSetMergeIterator(readMerger NodeReadMerger) *SiblingSetMergeIterator {
    return &SiblingSetMergeIterator{
        readMerger: readMerger,
        keys: make([][]string, 0),
        prefixes: make([]string, 0),
        keySet: make(map[string]bool),
        prefixIndexes: make(map[string]int),
        currentKeyIndex: -1,
        currentPrefixIndex: -1,
    }
}

func (iter *SiblingSetMergeIterator) AddKey(prefix string, key string) {
    if _, ok := iter.keySet[key]; ok {
        // Ignore this request. This key was already added before
        return
    }

    iter.keySet[key] = true

    if _, ok := iter.prefixIndexes[prefix]; !ok {
        // this is a prefix that hasn't been seen before. insert a new key list for this prefix
        iter.prefixIndexes[prefix] = len(iter.keys)
        iter.keys = append(iter.keys, []string{ })
        iter.prefixes = append(iter.prefixes, prefix)
    }

    prefixIndex := iter.prefixIndexes[prefix]
    iter.keys[prefixIndex] = append(iter.keys[prefixIndex], key)
}

func (iter *SiblingSetMergeIterator) SortKeys() {
    for _, keys := range iter.keys {
        sort.Strings(keys)
    }
}

func (iter *SiblingSetMergeIterator) Next() bool {
    if iter.currentPrefixIndex < 0 {
        iter.currentPrefixIndex = 0
    }
    
    if !(iter.currentPrefixIndex < len(iter.keys)) {
        return false
    }

    iter.currentKeyIndex++

    if iter.currentKeyIndex >= len(iter.keys[iter.currentPrefixIndex]) {
        iter.currentPrefixIndex++
        iter.currentKeyIndex = 0
    }

    return iter.currentPrefixIndex < len(iter.keys) && iter.currentKeyIndex < len(iter.keys[iter.currentPrefixIndex])
}

func (iter *SiblingSetMergeIterator) Prefix() []byte {
    if iter.currentPrefixIndex < 0 || iter.currentPrefixIndex >= len(iter.keys) || len(iter.keys) == 0 {
        return nil
    }

    return []byte(iter.prefixes[iter.currentPrefixIndex])
}

func (iter *SiblingSetMergeIterator) Key() []byte {
    if iter.currentPrefixIndex < 0 || iter.currentPrefixIndex >= len(iter.keys) || len(iter.keys) == 0 {
        return nil
    }

    if iter.currentKeyIndex >= len(iter.keys[iter.currentPrefixIndex]) {
        return nil
    }

    return []byte(iter.keys[iter.currentPrefixIndex][iter.currentKeyIndex])
}

func (iter *SiblingSetMergeIterator) Value() *SiblingSet {
    if iter.currentPrefixIndex < 0 || iter.currentPrefixIndex >= len(iter.keys) || len(iter.keys) == 0 {
        return nil
    }

    if iter.currentKeyIndex >= len(iter.keys[iter.currentPrefixIndex]) {
        return nil
    }

    return iter.readMerger.Get(iter.keys[iter.currentPrefixIndex][iter.currentKeyIndex])
}

func (iter *SiblingSetMergeIterator) LocalVersion() uint64 {
    return 0
}

func (iter *SiblingSetMergeIterator) Release() {
}

func (iter *SiblingSetMergeIterator) Error() error {
    return nil
}