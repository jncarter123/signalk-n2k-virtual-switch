const PLUGIN_ID = 'signalk-n2k-virtual-switch'
const PLUGIN_NAME = 'NMEA 2000 Virtual Switch'
const numIndicators = 28

module.exports = function(app) {
  var plugin = {};
  var virtualSwitch = {};
  var timer;

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = 'Emulates a NMEA 2000 Virtual Switch';

  plugin.schema = {
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

  plugin.start = function(options) {
    vsOptions = options
    if (typeof virtualSwitch === 'object' && Object.keys(virtualSwitch).length != 28) {
      initializeSwitch()

      timer = setInterval(function() {
        sendState()
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

          handleChange(pgn, fields)
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

    if (timer) {
      clearInterval(timer)
    }
  }

  function initializeSwitch() {
    for (let i = 0; i < numIndicators; i++) {
      virtualSwitch[`Indicator${i}`] = {
        "state": 2,
        "lastUpdated": Date.now()
      }
    }
    app.setProviderStatus('Virtual Switch initialized')
  }

  function handleChange(pgn, fields) {

    let instance, switchNum, value
    switch (pgn) {
      case 127502:
        instance = fields['Switch Bank Instance']
        let key = Object.keys(fields).filter((key) => /Switch\d+/.test(key)).toString()
        switchNum = key.match(/\d+/g).map(Number)
        value = fields[key]
        break
      case 126208:
        instance = fields['list'][0].Value
        switchNum = fields['list'][1].Parameter
        switchNum--
        value = fields['list'][1].Value
        break
    }

    //always update SK
    sendDelta(instance, switchNum, value)

    //update the virtual switch state
    virtualSwitch[`Indicator${switchNum}`].lastUpdated = Date.now()

    let currentState = virtualSwitch[`Indicator${switchNum}`].state
    if (currentState !== value) {
      //the state has changed so send an update on the NMEA network
      clearInterval(timer)

      virtualSwitch[`Indicator${switchNum}`].state = value

      sendState()

      timer = setInterval(function() {
        sendState()
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

      if (virtualSwitch[key].state != 2 && (vsOptions.stateTTL === 0 || Date.now() - virtualSwitch[key].lastUpdated <= vsOptions.stateTTL * 1000)) {
        pgn[key] = virtualSwitch[key].state === 1 ? 'On' : 'Off'
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
          "path": 'electrical.switches.bank.' + instance + '.' + indicator,
          "value": value
        }]
      }]
    }

    app.debug(JSON.stringify(delta))
    app.handleMessage(PLUGIN_ID, delta)
  }
  return plugin;
};
