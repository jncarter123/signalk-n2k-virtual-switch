# signalk-n2k-virtual-switch

The plugin emulates a NMEA 2000 Switch. It will respond to PGNS 127502 and Command PGN 126208. It will send the Binary Switch Bank Status PGN 127501 on a repeating basis.

Personlly I use this as an interface to display status from non-NMEA 2000 devices such as my router. I use Node-Red to SSH into the router every minute and get the state of the various WAN connections and display which connections are available and which connection is active.

I'm also using it for some dummy lights for things like battery voltage. If the battery voltage is within my specified range then the switch status is on. Otherwise it is off and I know to investigate further.

# Getting started
1.) Use the SignalK Appstore to install the signalk-n2k-virtual-switch plugin.<br/>
2.) Browse to Server => Plugin => NMEA 2000 Virtual Switch and enable it.<br/>
3.) Restart SignalK<br/>

## Configuration
The defaults should work for most situations but you can make changes as needed for your use case.

![Configuration](https://user-images.githubusercontent.com/30420708/77254310-44653400-6c2e-11ea-8ddc-1df61b83b87b.png)

# SignalK PUT
The plugin now supports the ability to send a PUT to the path of the switch. This opens up a lot of possibilities for use with WilhelmSK switch
gauge and/or Node-RED.

# API
An API is provided for use by external systems.

PUT to http://{{skserver}}/plugins/signalk-n2k-virtual-switch/virtualSwitch

The body should be a JSON object that follows the Canboat JSON for PGN 127502. The Switch Bank Instance should be the same as the
plugin is configured. The Switch0 should be "Switch" followed by the switch number from 1-28.
```JSON
{
    "pgn": 127502,
    "fields": {
        "Switch Bank Instance": 107,
        "Switch0": 1
    }
}
```
