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
const path = require('path')
const process = require('process')
const child_process = require('child_process')
const semver = require('semver')
const YAML = require('yamljs')
const fs = require('fs')

const DEVICEDB_COMPATIBLE_VERSIONS = '1.x'
const DEVICEDB_SOURCE_ROOT = '../deps/devicedb/src/devicedb'

class DeviceDB {
    constructor() {
        this.devicedb = process.env['DDB_PATH'] || path.resolve(__dirname, '../deps/devicedb/bin/devicedb')
        this.scratchPath = process.env['DDB_SCRATCH_PATH'] || '/tmp/devicedb-test'
        this.ddbProcess = null
        this.exitPromise = null
        
        process.on('exit', () => {
            this.stop()
        })
    }
    
    getVersion() {
        return new Promise((resolve, reject) => {
            child_process.exec(this.devicedb + ' -version', (error, version) => {
                if(!semver.valid(version.trim())) {
                    console.error('The version of DeviceDB at ' + this.devicedb + ' is incompatible with the test scripts: ' + version.trim())
                    reject(new Error('Invalid version'))
                    return
                }
                
                resolve(version.trim())
            })
        })
    }
    
    _clearScratchSpace() {
        return new Promise((resolve, reject) => {
            child_process.exec('rm -rf ' + path.resolve(this.scratchPath, '*'), (error, stdout, stderr) => {
                if(error || stderr) {
                    console.error('Unable to clear scratch space at ' + this.scratchPath, error || stderr)
                    
                    reject(error || stderr)
                    
                    return
                }
                
                resolve()
            })
        })
    }
    
    _createScratchSpace() {
        return new Promise((resolve, reject) => {
            child_process.exec('mkdir -p ' + path.resolve(this.scratchPath), (error, stdout, stderr) => {
                if(error || stderr) {
                    console.error('Unable to create scratch space at ' + this.scratchPath, error || stderr)
                    
                    reject(error || stderr)
                    
                    return
                }
                
                resolve()
            })
        })
    }
    
    _createTestConfig() {
        return this._createScratchSpace().then(() => {
            return new Promise((resolve, reject) => {
                let config = YAML.load(path.resolve(__dirname, DEVICEDB_SOURCE_ROOT, 'test_configs/test_config_0.yaml'))
                config.db = path.resolve(this.scratchPath, 'testdb')
                config.peers = [ ]
                
                for(let key in config.tls) {
                    config.tls[key] = path.resolve(__dirname, DEVICEDB_SOURCE_ROOT, 'test_configs/', config.tls[key])
                }
                
                try {
                    fs.writeFileSync(path.resolve(this.scratchPath, 'test_config.yaml'), YAML.stringify(config, 4))
                }
                catch(error) {
                    reject(error)
                    
                    return
                }
                
                resolve()
            })
        })
    }
    
    start() {
        if(this.ddbProcess != null) {
            return Promise.reject(new Error('Server already started'))
            
            return
        }
        
        return this.getVersion().then((version) => {
            if(!semver.satisfies(version, DEVICEDB_COMPATIBLE_VERSIONS)) {
                console.error('The version of DeviceDB at ' + this.devicedb + ' is incompatible with the test scripts')
                
                throw new Error('Invalid version')
            }
        }).then(() => {
            return this._clearScratchSpace()
        }).then(() => {
            return this._createTestConfig()
        }).then(() => {
            this.ddbProcess = child_process.spawn(this.devicedb, [ 'start', '-conf=' + path.resolve(this.scratchPath, 'test_config.yaml') ], {
                detached: false,
                stdio: [ 'ignore', 'pipe', 'inherit' ]
            })
                
            this.exitPromise = new Promise((resolve) => {
                this.ddbProcess.on('exit', () => {
                    this.ddbProcess = null
                    this.exitPromise = null
                    resolve()
                }).on('error', () => {
                    this.ddbProcess = null
                    this.exitPromise = null
                    resolve()
                })
            })
            
            return new Promise((resolve, reject) => {
                this.ddbProcess.stdout.on('data', (chunk) => {
                    if(/Node .+ listening on port .+/.test(chunk.toString())) {
                        // this.ddbProcess.stdout.pause()
                        resolve()
                    }
                }).on('end', () => {
                    //this.ddbProcess.stdout.pause()
                    reject()
                })
                
                this.ddbProcess.once('exit', () => {
                    if(this.ddbProcess) {
                        //this.ddbProcess.stdout.pause()
                        reject()
                    }
                })
            })
        })
    }
    
    stop() {
        if(this.ddbProcess == null) {
            return Promise.resolve()
        }
    
        this.ddbProcess.stdout.pause()
        this.ddbProcess.stdout.removeAllListeners()
        this.ddbProcess.kill()
        return this.exitPromise.then(() => {
            this.ddbProcess = null
            this.exitPromise = null
        })
    }
}

module.exports = DeviceDB