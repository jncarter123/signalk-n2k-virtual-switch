const fs = require('fs')

const PLUGIN_ID = 'signalk-n2k-virtual-switch'
const PLUGIN_NAME = 'NMEA 2000 Virtual Switch'
const numIndicators = 28
const pdStateSuffix = '-powerDownState.json'

module.exports = function(app) {
  var plugin = {};
  var virtualSwitch = {};
  var vsTimer;
  let onStop = []
  let registeredPaths = []
  var n2kCallback
  var vsOptions

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = 'Emulates a NMEA 2000 Virtual Switch';

  function createChannelSchema(schema) {
    let channels = {
      type: 'object',
      title: 'Switch Channels',
      properties: {}
    }

    for (let i = 1; i <= numIndicators; i++) {
      let channel = {
        type: "object",
        title: "Channel " + i,
        required: ['label'],
        properties: {
          enableChannel: {
            type: 'boolean',
            title: 'Enable the channel',
            default: true
          },
          label: {
            type: 'string',
            title: 'Name of Channel',
            description: '',
            default: i.toString()
          },
          defaultState: {
            type: 'string',
            title: 'Power Up State',
            description: 'Default state when the plugin starts.',
            enum: [
              "OFF",
              "ON",
              "Previous"
            ],
            default: "OFF"
          },
          enableTTL: {
            type: 'boolean',
            title: 'Enable Time to Live',
            description: 'Enable the TTL for this channel so that state will timeout and stop sending updates. Great for dummy indicators..',
            default: false
          }
        }
      }
      channels.properties[i] = channel
    }

    schema.properties["channels"] = channels
    return schema
  }

  plugin.schema = function() {
    var schema = {
      type: "object",
      properties: {
        virtualInstance: {
          type: 'number',
          title: 'Instance # of the Virtual Switch',
          default: 107
        },
        sendRate: {
          type: 'number',
          title: 'Send Rate(seconds)',
          description: 'Switch updates will be sent periodically and on switch change.',
          default: 15
        },
        stateTTL: {
          type: 'number',
          title: 'Time to Live(seconds)',
          description: 'Switch state will be cached for the time to live period. A setting of 0 = unlimited.',
          default: 60
        }
      }
    }

    createChannelSchema(schema)
    return schema
  }

  plugin.start = function(options, restartPlugin) {
    vsOptions = options

    subscribeUpdates()

    if (typeof virtualSwitch === 'object' && Object.keys(virtualSwitch).length < 1) {
      initializeSwitch()

      vsTimer = setInterval(function() {
        sendState()
        sendPeriodicDeltas()
      }, vsOptions.sendRate * 1000)
    }

    n2kCallback = (msg) => {
      try {
        var fields = msg['fields']

        if (msg.pgn == 127502 && fields['Switch Bank Instance'] == vsOptions.virtualInstance ||
          (msg.pgn == 126208 && fields['Function Code'] == 'Command' &&
            fields['PGN'] == 127501 && fields['list'][0].Value == vsOptions.virtualInstance)) {

          app.debug('Received a virtual switch control update.')
          app.debug('msg: ' + JSON.stringify(msg))

          handleChange(msg.pgn, fields)
        }
      } catch (e) {
        console.error(e)
      }
    }
    app.on("N2KAnalyzerOut", n2kCallback)
  }

  plugin.registerWithRouter = function(router) {
    router.put("/virtualSwitch", (req, res) => {

      var msg = req.body

      let example = 'Must include object for the 127502 PGN. ex. {"pgn":127502,"fields":{"Switch Bank Instance": X, "SwitchY": 0|1}}'
      if (typeof msg == 'undefined') {
        app.debug('invalid request: ' + data)
        res.status(400)
        res.send('Invalid Request. ' + example)
        return
      }

      try {
        let pgn = msg.pgn
        let fields = msg['fields']

        let instance = fields['Switch Bank Instance']
        if (instance !== vsOptions.virtualInstance) {
          res.status(400)
          res.send('Invalid Request. Incorrect instance number. ' + example)
          return
        }

        let key = Object.keys(fields).filter((key) => /Switch\d+/.test(key)).toString()
        let switchNum = key.match(/\d+/g).map(Number)
        if (switchNum < 1 || switchNum > 28) {
          res.status(400)
          res.send('Invalid Request. Incorrect Switch number. ' + example)
          return
        }

        if (fields[key] !== 0 && fields[key] !== 1) {
          res.status(400)
          res.send('Invalid Request. Switch state must be a 0 or 1. ' + example)
          return
        }

        handleChange(pgn, fields)

        res.send('Instance ' + instance + ' ' + key + ' switched ' + (fields[key] ? 'on' : 'off'))
      } catch (err) {
        app.debug(err)
        res.status(400)
        res.send('Invalid Request. ' + example)
      }
    })
  }

  plugin.stop = function() {
    if (n2kCallback) {
      app.removeListener("N2KAnalyzerOut", n2kCallback)
      n2kCallback = undefined
    }

    if (vsTimer) {
      clearInterval(vsTimer)
    }

    onStop.forEach(f => f())
    onStop = []

    saveState()

    virtualSwitch = {}
    app.debug('Plugin stopped.')
  }

  function initializeSwitch() {
    app.debug("Initializing vSwitch")

    let channels = vsOptions.channels
    let pdState = getPowerDownState()

    for (let i = 1; i <= numIndicators; i++) {
      let channelEnabled = true
      let label
      let state
      if (channels) {
        channelEnabled = channels[i].hasOwnProperty('enableChannel') ? channels[i].enableChannel : true

        label = channels[i].label

        if (pdState) {
          state = channels[i].defaultState === "Previous" ? pdState[i] : channels[i].defaultState
        } else {
          state = channels[i].defaultState === "Previous" ? "OFF" : channels[i].defaultState
        }
      } else {
        label = i.toString()
        state = "OFF"
      }

      if(channelEnabled){
        virtualSwitch[i] = {
          "label": label,
          "state": state === "ON" ? 1 : 0,
          "lastUpdated": Date.now()
        }
        sendDelta(vsOptions.virtualInstance, label, 2)
      }
    }
    app.setPluginStatus('Virtual Switch initialized')
  }

  function handleChange(pgn, fields) {

    let instance, switchNum, value
    switch (pgn) {
      case 127502:
        instance = fields['Switch Bank Instance']
        let key = Object.keys(fields).filter((key) => /Switch\d+/.test(key)).toString()
        switchNum = key.match(/\d+/g).map(Number)
        value = fields[key] === 'On' || fields[key] === 1 ? 1 : 0
        break
      case 126208:
        instance = fields['list'][0].Value
        switchNum = fields['list'][1].Parameter
        switchNum--
        value = fields['list'][1].Value === 'On' || fields['list'][1].Value === 1 ? 1 : 0
        break
    }

    //always update SK
    let label = vsOptions.channels ? vsOptions.channels[switchNum].label :switchNum
    sendDelta(instance, label, value)

    //update the virtual switch state
    virtualSwitch[switchNum].lastUpdated = Date.now()

    let currentState = virtualSwitch[switchNum].state
    if (currentState !== value) {
      //the state has changed so send an update on the NMEA network
      clearInterval(vsTimer)

      virtualSwitch[switchNum].state = value

      sendState()

      if (vsOptions.channels && vsOptions.channels[switchNum].defaultState === 'Previous') {
        saveState()
      }

      vsTimer = setInterval(function() {
        sendState()
        sendPeriodicDeltas()
      }, vsOptions.sendRate * 1000)
    }
  }

  function sendState() {
    //send status update 127501
    const pgn = {
      pgn: 127501,
      dst: 255,
      "Instance": vsOptions.virtualInstance
    }

    let keys = Object.keys(virtualSwitch)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]

      let notExpired = ((Date.now() - virtualSwitch[key].lastUpdated) <= (vsOptions.stateTTL * 1000)) ? true : false
      if (vsOptions.stateTTL === 0 || !vsOptions.channels[key].enableTTL || (vsOptions.channels[key].enableTTL && notExpired)) {
        pgn[`Indicator${key}`] = virtualSwitch[key].state === 1 ? 'On' : 'Off'
      }
    }

    if (Object.keys(pgn).length > 3) {
      app.debug('sending pgn %j', pgn)
      app.emit('nmea2000JsonOut', pgn)
    } else {
      app.debug('nothing to send %j', pgn)
    }
  }

  function sendDelta(instance, indicator, value) {
    let delta = {
      "updates": [{
        "values": [{
          "path": `electrical.switches.bank.${instance}.${indicator}.state`,
          "value": value
        }]
      }]
    }

    app.debug(JSON.stringify(delta))
    app.handleMessage(PLUGIN_ID, delta)
  }

  function subscribeUpdates() {
    let command = {
      context: "vessels.self",
      subscribe: [{
        path: `electrical.switches.bank.${vsOptions.virtualInstance}.*`,
        period: 1000
      }]
    }

    app.debug('subscribe %j', command)

    app.subscriptionmanager.subscribe(command, onStop, subscription_error, delta => {
      delta.updates.forEach(update => {
        update.values.forEach(value => {
          const path = value.path
          const key = `${path}.${update.$source}`
          if (path.endsWith('state') && registeredPaths.indexOf(key) === -1) {
            app.debug('register action handler for path %s source %s', path, update.$source)
            app.registerActionHandler('vessels.self',
              path,
              (context, path, value, cb) => {
                return actionHandler(context, path, update.$source, value, cb)
              },
              update.$source)
            registeredPaths.push(key)
          }
        })
      })
    })
  }

  function actionHandler(context, path, dSource, value, cb) {
    app.debug(`setting ${path} to ${value}`)

    const parts = path.split('.')
    let instance = Number(parts[3])
    let label = parts[4]
    let labelPaths = findPaths(vsOptions, "label", label)
    let switchNum = labelPaths.length > 0 ? labelPaths[0].split('.')[1] : label

    let msg = {
      "pgn": 127502,
      "fields": {
        "Switch Bank Instance": instance
      }
    }
    msg.fields[`Switch${switchNum}`] = value

    let pgn = msg.pgn
    let fields = msg['fields']

    try {
      handleChange(pgn, fields)

      cb({
        state: 'SUCCESS'
      })
    } catch (err) {
      app.error(err)

      cb({
        state: 'FAILURE'
      })
    }

    return {
      state: 'SUCCESS'
    }
  }

  function subscription_error(err) {
    app.setProviderError(err)
  }

  function sendPeriodicDeltas() {
    let keys = Object.keys(virtualSwitch)
    let values = (keys.map(key => ({
      "path": `electrical.switches.bank.${vsOptions.virtualInstance}.${vsOptions.channels ? vsOptions.channels[key].label : key}.state`,
      "value": virtualSwitch[key].state
    })))

    let delta = {
      "updates": [{
        "values": values
      }]
    }
    app.debug(JSON.stringify(delta))

    app.handleMessage(PLUGIN_ID, delta)
  }

  function saveState() {
    let pdState = {}
    
    let keys = Object.keys(virtualSwitch)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      pdState[key] = virtualSwitch[key].state === 1 ? "ON" : "OFF"
    }

    let filepath = app.getDataDirPath() + pdStateSuffix

    app.debug('Writing ' + JSON.stringify(pdState) + ' to file ' + filepath)

    try {
        fs.writeFileSync(filepath, JSON.stringify(pdState, null, 2))
    } catch (e) {
        app.error('Could not write to ' + filepath + ' ERROR: ' + err)
    }
  }

  function getPowerDownState() {
    let pdStateAsString = '{}'
    let pdState
    let filepath = app.getDataDirPath() + pdStateSuffix
    try {
      pdStateAsString = fs.readFileSync(filepath, 'utf8')
    } catch (e) {
      app.debug('Could not get powerDownState from ' + filepath + ' - ' + e)
    }
    try {
      pdState = JSON.parse(pdStateAsString)
    } catch (e) {
      app.debug('Could not parse pdState - ' + e)
    }
    return pdState
  }

  function findPaths(obj, propName, value, prefix = '', store = []) {
    for (let key in obj) {
      const curPath = prefix.length > 0 ? `${prefix}.${key}` : key
      if (typeof obj[key] === 'object') {
        if (!propName || curPath.includes(propName)) {
          store.push(curPath)
        }
        findPaths(obj[key], propName, value, curPath, store);
      } else {
        if ((!propName || curPath.includes(propName)) &&
          (!value || obj[key] == value)) {
          store.push(curPath)
        }
      }
    }
    return store;
  }

  return plugin;
};
