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
const path = require('path')
const devicejs = require('../core/httpPeer')
const devicedb = require('./devicedb')
const defaults = require('./defaults.json')
const jsonminify = require('jsonminify')
const logging = require('../core/logging')
const config = require('./config')

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

let corePeer = new devicejs.DeviceJSPeer(djsconfig.uri, djsconfig)
let ddb = devicedb(djsconfig.databaseConfig)

return corePeer.connect().then(() => {
    var modulePath = path.resolve(process.cwd(), argv._[0])

    global.dev$ = corePeer
    global.devicejs = devicejs.DeviceJSPeer
    global.ddb = global.devicedb = ddb
    global.modules = require('./module')(corePeer)
    global.log = logging('module')

    if(typeof argv._[0] !== 'string') {
        throw 'No valid script specified'
    }

    return global.modules.load(modulePath)
}).then(() => {
}, (error) => {
    console.error(error)
    
    process.exit(1);
})
