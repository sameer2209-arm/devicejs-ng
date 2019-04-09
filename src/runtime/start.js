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

const argv = require('optimist').argv
const process = require('process')
const defaults = require('./defaults.json')
const config = require('./config')
const devicejs = require('../core/httpCore')
const devicedb = require('./devicedb')
const logging = require('../core/logging')

let djsconfig

try {
    if(typeof argv.config === 'string') {
        djsconfig = config.loadConfigFromFile(argv.config)
    }
    else {
        djsconfig = config.loadConfigFromFile(defaults.configFile)
    }
}
catch(error) {
    console.error(error.message)
    process.exit(1)
}

let coreServer = new devicejs.DeviceJSCore(djsconfig.port, djsconfig)
let corePeer = new devicejs.DeviceJSPeer(djsconfig.uri, djsconfig)
let ddb = devicedb(djsconfig.databaseConfig)

console.log('Step1')
return coreServer.start().then(() => {
    console.log('Step2')
    return corePeer.connect()
}).then(() => {
    console.log('Step3')
    global.dev$ = corePeer
    global.devicejs = devicejs.DeviceJSPeer
    global.ddb = global.devicedb = ddb
    global.modules = require('./module')(corePeer)
    global.log = logging('module')
}).then(() => {
    console.log('Started DeviceJS Server')
}, (error) => {
    console.error('Error starting core server', error.stack)
})
