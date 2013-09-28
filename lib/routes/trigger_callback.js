var redis = require('../redis');
var debug = require('../debug');
var msgpack = require('msgpack');

function trigger_callback (request, response) {
    response.writeHead(200, {"Content-Type": "application/json" });

    // request is the geotrigger response
    var trigger_event = JSON.parse(request.body);

    try {
        var device_id = trigger_event.device.deviceId;
        var coin_id = trigger_event.trigger.triggerId;
        var coin_location = trigger_event.trigger.condition;
        var coin_value = trigger_event.trigger.properties.value;
        var timestamp = trigger_event.triggeredAt;

        debug('trigger', "recieved trigger from device_id: " + device_id + ", coin_id: " + coin_id);

    } catch(e) {
        debug('trigger', e);
        response.end(JSON.stringify({"error":e.message}));
    }

    if (device_id) {

        var message = {coin_id: coin_id, location: coin_location, timestamp: timestamp, value: coin_value, device_id: device_id};
       
        debug('trigger', "Message so far:");
        debug('trigger', message); 
        
        // get game from redis
        redis.device.get_active_game(device_id, function(err, vals) {

          if (err) {
            response.end(JSON.stringify({"error": err}));
          } else if (vals == null) {
            // no game
            response.end(JSON.stringify({"error": 'ENOGAME'}));
          } else {
            var game_id = vals.game_id;
            var team = vals.team;
            debug('trigger', "Got game:"+game_id); 

            // sets coin ownership and increments score
            redis.game.set_coin_ownership(device_id, game_id, coin_id, function(err, team){
              if (err) {
                // error or coin has already been claimed
                response.end(JSON.stringify({"error": err}));
              } else {
                debug('trigger', 'set coin ownership to team:'+team);
                message.team = team;

                redis.game.get_scores(device_id, function(err, scores) {

                  if (err) {
                    response.end(JSON.stringify({"error": err}));
                  }
                  else if (scores == null) {
                    response.end(JSON.stringify({"error": 'ENOSCORE'}));
                  } else {
                    debug('trigger', 'new player score:'+scores.player_score);
                    message.player_score = scores.player_score;
                    message.red_score = scores.red_score;
                    message.blue_score = scores.blue_score;

                    debug('trigger', "Broadcast Message:");
                    debug('trigger', message);
                    broadcast_trigger(game_id, message, function(err, vals) {
                      if (err) {
                        response.end(JSON.stringify({"error": err}));
                      } else {
                        response.end({});
                      }
                    });
                  }
                });
              } 
            });
          }
        });
    }
}

function broadcast_trigger(game_id, message, callback) {
  var message = msgpack.pack(message);
  // broadcast information to all players in the game
  redis.game.get_players(game_id, function(err, player_vals) {
    if (err) {
        callback(err);
    } else {
        [player_vals.red, player_vals.blue].forEach(function(players) {
            players.forEach(function(device_id){
              redis.device.get_udp_info(device_id, function(err, udp_info) {
                if(err){
                  callback(err);
                } else {
                  udp_server.send(message, 0, message.length, udp_info.port, udp_info.address, function (err, data) {
                    if (err) {
                      callback(err);
                    } else {
                      callback(null, 1);
                    }
                  });
                }
              });
          });
        });
    }
  });
}

module.exports = exports = trigger_callback;