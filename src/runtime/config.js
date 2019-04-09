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
const fs = require('fs')
const url = require('url')
const jsonminify = require('jsonminify')
const x509 = require('x509')
const errors = require('../core/errors')
const djsutil = require('../core/util')

const DEFAULT_DEVICEJS_PORT = 8080
const DEVICEJS_LOCAL_PORT = 23242
const DEVICEDB_LOCAL_PORT = 9001

class Configuration {
    constructor(rawConfig) {
    }
}

let loadConfigFromFile = (configFile) => {
    return djsconfig(JSON.parse(jsonminify(fs.readFileSync(configFile, 'utf8'))), configFile)
}

let djsconfig = (config, configFile) => {
    validateConfig(config)
    
    fillInHTTPS(configFile, config.https)
    fillInHTTPS(configFile, config.https.server)
    fillInHTTPS(configFile, config.https.client)
    fillInHTTPS(configFile, config.databaseConfig.https)
    
    config.databaseConfig.https = config.databaseConfig.https || config.https
    config.https.client = config.https.client || config.https
    config.https.server = config.https.server || config.https
    config.uri = 'http://127.0.0.1:' + DEVICEJS_LOCAL_PORT
    
    return config
}

let validateConfig = (config) => {
    if(!isDefined(config.modulesDirectory)) {
        console.warn('Configuration has no "modulesDirectory" field. No modules will be loaded')
        config.modulesDirectory = null
    }
    else if(!isDirectory(config.modulesDirectory)) {
        console.warn(config.modulesDirectory + ' is not a valid directory. No modules will be loaded')
        config.modulesDirectory = null
    }
    
    if(!isDefined(config.port)) {
        console.warn('Configuration has no "port" field. The default port will be used (' + DEFAULT_DEVICEJS_PORT + ')')
        config.port = DEFAULT_DEVICEJS_PORT
    }
    else if(!isValidPort(config.port)) {
        console.warn(config.port + ' is not a valid server port. The default port will be used (' + DEFAULT_DEVICEJS_PORT + ')')
        config.port = DEFAULT_DEVICEJS_PORT
    }
    
    if(!isDefined(config.cloudAddress)) {
        console.warn('Configuration has no "cloudAddress" field. This DeviceJS node will not establish a cloud connection.')
        config.cloudAddress = null
    }
    else if(!isValidURL(config.cloudAddress)) {
        console.warn(config.cloudAddress + ' is not a valid url. This DeviceJS node will not establish a cloud connection.')
        config.cloudAddress = null
    }
    
    if(!isDefined(config.databaseConfig)) {
        throw new errors.ConfigurationError('Configuration has no "databaseConfig" field')
    }
    
    validateDBConfig(config.databaseConfig)
    
    if(!isDefined(config.https)) {
        console.warn('Configuration has no "https" field. This DeviceJS node will not accept secure connections.')
        config.https = null
    }
    
    if(!validateHTTPSConfig(config.https)) {
        console.warn('Configuration has an improperly formatted "https" field. This DeviceJS node will not accept secure connections.')
        config.https = null
    }

    if(!isDefined(config.nodeID) || !isValidNodeID(config.nodeID)) {
        if(config.https == null) {
            console.warn('Since there is no valid "nodeID" field specified and the config has no valid client certificate specified a random nodeID will be used for this session.')
            config.nodeID = djsutil.uuid()
        }
        else {
            config.nodeID = extractNodeID(config.https)
            
            if(!config.nodeID) {
                console.warn('Failed to get the node ID from the specified TLS certificates. A random nodeID will be used for this session.')
                config.nodeID = djsutil.uuid()
            }
        }
    }
    else {
        if(config.https == null) {
            config.nodeID = config.nodeID
        }
        else {
            console.warn('The "nodeID" field will be ignored since a valid client certificate was specified. Certificate common name will be used as the node ID.')
            config.nodeID = extractNodeID(config.https)
            
            if(!config.nodeID) {
                console.warn('Failed to get the node ID from the specified TLS certificates. A random nodeID will be used for this session.')
                config.nodeID = djsutil.uuid()
            }
        }
    }
}

let validateDBConfig = (dbConfig) => {
    if(typeof dbConfig !== 'object' || dbConfig === null) {
        throw new errors.ConfigurationError('Configuration has an invalid "databaseConfig" field')
    }
    
    if(!isDefined(dbConfig.uri)) {
        throw new errors.ConfigurationError('Database config has no "uri" field specifying where to connect to the DeviceDB server')
    }
    
    if(!isValidURL(dbConfig.uri)) {
        throw new errors.ConfigurationError('Database config has an invalid "uri" field specified.')
    }
    
    if(typeof dbConfig.https !== 'object' || dbConfig.https === null) {
        console.warn('Database config has no valid "https" options. Defaulting to global https options')
        
        dbConfig.https = null
    }
    else if(!Array.isArray(dbConfig.https.ca)) {
        console.warn('Database config has no valid "https" options. Defaulting to global https options')
        
        dbConfig.https = null
    }
    else {
        for(let c of dbConfig.https.ca) {
            if(typeof c !== 'string') {
                console.warn('Database config has no valid "https" options. Defaulting to global https options')
                dbConfig.https.ca = null
                
                break
            }
        }
    }
}

let validateHTTPSConfig = (httpsConfig) => {
    return true
}

let extractNodeID = (httpsConfig) => {
    try {
        if(typeof httpsConfig.cert == 'string') {
            let subject = x509.getSubject(httpsConfig.cert)
            
            return subject.commonName
        }
        else if(httpsConfig.client && httpsConfig.server && typeof httpsConfig.client.cert === 'string' && typeof httpsConfig.server.cert === 'string') {
            let clientSubject = x509.getSubject(httpsConfig.client.cert)
            let serverSubject = x509.getSubject(httpsConfig.server.cert)
            
            if(clientSubject.commonName !== serverSubject.commonName) {
                console.warn('Client and server certificate common names do not match. Cannot extract a node ID from the TLS certificates')
                
                return null
            }
            
            return clientSubject.commonName
        }
    }
    catch(error) {
        console.warn('Unable to extract a common name from the ssl certificate: ' + error.message)
    }
    
    return null
}

let isDefined = (value) => {
    return typeof value !== 'undefined'
}

let isDirectory = (path) => {
    try {
        let stats = fs.statSync(path)
        
        return stats.isDirectory()
    }
    catch(error) {
        return false
    }
}

let isValidPort = (port) => {
    if(typeof port !== 'number') {
        return false
    }
    
    if(port % 1 !== 0) {
        return false
    }
    
    if(port <= 0 || port > 65535) {
        return false
    }
    
    return true
}

let isValidURL = (u) => {
    try {
        let parsedURL = url.parse(u)
        
        if(parsedURL.protocol !== 'http:' && parsedURL.protocol !== 'https:') {
            return false
        }
        
        if(parsedURL.hostname === '' || parsedURL.hostname === null) {
            return false
        }
        
        return true
    }
    catch(error) {
        return false
    }
}

let fillInHTTPS = (configDir, httpsOptions) => {
    if(!httpsOptions) {
        return
    }
    
    if(httpsOptions.ca) {
        for(var i = 0; i < httpsOptions.ca.length; i += 1) {
            httpsOptions.ca[i] = fs.readFileSync(path.resolve(configDir, httpsOptions.ca[i]), 'utf8')
        }
    }
    
    if(httpsOptions.key) {
        httpsOptions.key = fs.readFileSync(path.resolve(configDir, httpsOptions.key), 'utf8')
    }
    
    if(httpsOptions.cert) {
        httpsOptions.cert = fs.readFileSync(path.resolve(configDir, httpsOptions.cert), 'utf8')
    }
}

module.exports = {
    loadConfigFromFile
}