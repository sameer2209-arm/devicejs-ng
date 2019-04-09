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

/**
 * An asynchronous analog to a mutex
 * in multithreaded programming. This is
 * used to coordinate access to a series
 * of asynchronous callbacks or chained
 * promises. In asynchronous programming
 * the same chain of promises executed
 * twice can become intermixed during 
 * execution such that the sequence of
 * the first effectively happens in parallel
 * with the second.
 * 
 * @class AsyncMutex
 * @constructor
 * * @example
 * ```
 * let lock = new AsyncMutex()
 * 
 * function cs() {
 *     lock.acquire().then(function() {
 *         ...
 *     }).then(function() {
 *         ...
 *     }).then(function(result) {
 *         lock.release()
 *         return result
 *     }, function(error) {
 *         lock.release()
 *         throw error
 *     })
 * }
 * ```
 */
class AsyncMutex {
    constructor() {
        this.queue = [ ]
        this.acquired = false
    }

    /**
     * This method returns a promise that resolves
     * as soon as all other callers of acquire()
     * have invoked release(). When the promise
     * resolves, you can access to critical section
     * or protected resource
     * 
     * @method acquire
     * @return {Promise}
     */
    acquire() {
        let self = this
    
        return new Promise(function(resolve, reject) {
            if(self.acquired) {
                self.queue.push(resolve)
            }
            else {
                self.acquired = true
                resolve()
            }
        })
    }

    /**
     * This method indicates that you are done
     * with the critical section and will give
     * control to the next caller to acquire()
     * 
     * @method release
     */
    release() {
        let next = this.queue.shift()
    
        if(next) {
            next()
        }
        else {
            this.acquired = false
        }
    }
    
    /**
     * This method returns the length of the
     * number of threads waiting to acquire
     * this lock
     */
    queueSize() {
        return this.queue.length
    }
}

class AsyncLockMap {
    constructor() {
        this.map = new Map()
    }
    
    acquire(key) {
        if(!this.map.has(key)) {
            this.map.set(key, new AsyncMutex())
        }
        
        return this.map.get(key).acquire()
    }
    
    release(key) {
        if(this.map.has(key)) {
            this.map.get(key).release()
            
            if(this.map.get(key).queueSize() == 0) {
                this.map.delete(key)
            }
        }
    }
}

class AsyncRWLock {
	constructor() {
		this.readerQueue = [ ]
        this.writerQueue = [ ]
		this.readers = 0
		this.writers = 0
	}

	rlock() {
		return new Promise((resolve, reject) => {
			if(this.writers != 0 || this.writerQueue.length != 0) {
			    this.readerQueue.push(resolve)

			    return
			}

			this.readers ++

			resolve()
		})
	}

	runlock() {
		let nextWriter = this.writerQueue.shift()

		this.readers --

		if(this.writers == 0 && nextWriter) {
		    this.writers = 1

			nextWriter()

			return
	    }
	}

	wlock() {
		return new Promise((resolve, reject) => {
			if(this.readers != 0 || this.writers != 0) {
				this.writerQueue.push(resolve)

				return
			}

			this.writers = 1

			resolve()
		})
	}

	wunlock() {
		let nextWriter = this.writerQueue.shift()

		if(nextWriter) {
			nextWriter()

			return
		}

		this.writers = 0

		for(let nextReader of this.readerQueue) {
			this.readers ++

			nextReader()
		}
	}
}

module.exports = {
    AsyncLockMap: AsyncLockMap,
    AsyncMutex: AsyncMutex,
    AsyncRWLock: AsyncRWLock
}
