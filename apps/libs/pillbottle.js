var mysql      = require('mysql');
var config = require('./config.json')
var connection = mysql.createConnection({
  host     : config.mysql.host,
  user     : config.mysql.user,
  password : config.mysql.password,
  database : config.mysql.database
});
var _ = require('underscore');
var async = require('async');
var pillbottle = {};

connection.connect();

pillbottle.addDoctor = function(doctorUsername, pillBottleId, callback) {
    // checking if doctor is valid one
    var qry = "SELECT * FROM users WHERE username = ? AND typeId = 2";
    connection.query(qry, [doctorUsername], function(error, results, fields) {
        if(error) {
            console.log(error);
            return callback({status: 500, message: 'DB Error'}, null);
        }
        var doctorId = results[0].id;
        if(_.isEmpty(results))
            return callback('Invalid Doctor ID', null);
        var qry = 'INSERT INTO userpill SET ? ';
        connection.query(qry, { userId: doctorId, pillBottleId: pillBottleId }, function(error, results, fields) {
            if(error) {
                if(error.code == 'ER_DUP_ENTRY')
                    return callback({status: 400, message: 'Already registterd with doctor'}, null);
                return callback({status: 500, message: 'DB Error'}, null);
            }
            callback(null, results);
        })
    })
}

pillbottle.verifyModAccess = function (userId, pillBottleId, callback) {
    var qry = "SELECT users.name FROM users, userpill " + 
    "WHERE users.id = ? AND users.typeId = 2 AND userpill.pillBottleId = ? AND userpill.userId = ?";

    connection.query(qry, [userId, pillBottleId, userId], function(error, results, fields) {
        if(error) {
            console.log(error);
            return callback('DB Error', null);
        }
        callback(null, results);
    })
}

pillbottle.getById = function (userId, pillBottleId, callback) {
    var qry = "SELECT pb.pill, pb.course, pb.description, dosage.timestamp, pb.id " +
        "FROM PillBottle pb, UserPill userpill, PillBottleDosage dosage " +
        "WHERE userpill.userId = ? AND userpill.pillBottleId = ? AND dosage.pillBottleId = ? AND pb.id = ?";
    // connection.connect();
    connection.query(qry, [userId, pillBottleId, pillBottleId, pillBottleId], function(error, results, fields) {
        if(error){
            console.log(error);
            return callback ('DB Error', null);
        }
        if(!results)
            return callback(null, results);
        var retObj = {};
        retObj.id = pillBottleId;
        retObj.pill = results[0].pill;
        retObj.course = results[0].course;
        retObj.description = results[0].description;
        retObj.dosage = _.map(results, function(obj) {
                return { time: obj.timestamp };
            })
        return callback(null, results[0]);
    });
    // connection.end();
}

pillbottle.getPatientDevIds = function(pillBottleId, callback) {
    var qry = "SELECT userdevice.userId, userdevice.platform, userdevice.deviceId " +
        "FROM users, userpill, userdevice " +
        "WHERE users.typeId = 1 AND userpill.userId = users.id AND userpill.pillbottleid = ? AND userdevice.userId = userpill.userId";
    connection.query(qry, [pillBottleId], function(error, results, fields) {
        if(error) {
            console.log(error);
            return callback('DB Error', null);
        }
        if(_.isEmpty(results))
            return callback(null, results);
        var retObj = {
            all: _.pluck(results, 'deviceId'),
            android: _.pluck(_.where(results, { platform: 1 }), 'deviceId'),
            ios: _.pluck(_.where(results, { platform: 2 }), 'deviceId')
        };

        callback(null, retObj);
    })
}

// can be made more efficient. Do asynchronously then if any one returns error, rollback the rest.
pillbottle.newDosage = function(pillBottleId, description, pill, dosage, callback) {
    var qry = "UPDATE pillbottle SET pill = ?, description = ?, courseId = courseId +1 WHERE id = ?";
    // connection.on('error', function(err) {
    //     console.log("I ain't not gonna throw that error mofo");
    // })
    connection.beginTransaction(function(err) {
        if(err) { 
            // throw err; 
            return callback('DB Error', null);
        }
        connection.query(qry, [pill, description, pillBottleId], function(error, results, fields) {
            if(error) {
                connection.rollback();
                return callback('DB Error', null);
            }
            var qry2 = "DELETE FROM pillbottledosage WHERE pillbottleid = ?";
            connection.query(qry2, [pillBottleId], function(error, results, fields) {
                if(error) {
                    console.log(error);
                    connection.rollback();
                    return callback('DB Error', null);
                }
                var qry3 = "INSERT INTO PillBottleDosage (pillBottleId, timestamp) VALUES ?";
                var arr = [];
                console.log(dosage);
                for(i in dosage) {
                    var item = [];
                    item.push(pillBottleId);
                    item.push(dosage[i].time);
                    arr.push(item);
                }
                console.log(arr);
                connection.query(qry3, [arr], function(error, results, fields) {
                    if(error) {
                        console.log(error);
                        connection.rollback();
                        return callback('DB Error', null);
                    }
                    console.log(results);
                    connection.commit(function(err) {
                        if(err) {
                            connection.rollback();
                            return callback('DB Error', null);
                        }
                        callback(null, 'Success');
                    })
                    
                })
            })
        })
    })    
}

pillbottle.removeDosage = function(pillBottleId, callback) {

    connection.beginTransaction(function(err) {
        if(err) {
            console.log(err);
            return callback('DB Error', null);
        }
        async.parallel([
            function(cb) {
                var qry = "UPDATE pillbottle SET pill = NULL, description = NULL WHERE id = ? ";
                connection.query(qry, [pillBottleId], function(error, results, fields) {
                    if(error) {
                        cb(error, null);
                    }
                    cb(null, results);
                })
            },
            function(cb) {
                var qry = "DELETE FROM pillbottledosage WHERE pillBottleId = ?";
                connection.query(qry, [pillBottleId], function(error, results, fields) {
                    if(error) {
                        cb(error, null);
                    }
                    cb(null, results);
                })
            }
        ], function(error, results) {
            if(error) {
                console.log(error);
                connection.rollback();
                return callback(error, null);
            }
            connection.commit(function(error) {
                if(error) {
                    console.log(error);
                    connection.rollback();
                    return callback(error, null);
                }
                callback(null, results);
            })
        })
    })        
}
pillbottle.getAllByUserId = function (userId, callback) {

    var qry = "SELECT pb.pill, pb.course, pb.description, dosage.timestamp, pb.id " + 
    "FROM PillBottle pb, UserPill userpill, PillBottleDosage dosage " + 
    "WHERE userpill.userId = ? AND pb.id = userpill.pillBottleId AND dosage.pillBottleId = userpill.pillBottleId;"

    // connection.connect();
    connection.query(qry, [userId], function(error, results, fields) {
        if(error) {
            return callback('DB Error', null);
        }
        console.log(JSON.stringify(results));
        var grouped = _.groupBy(results, function(obj) { return obj.id })
        var objectified = _.mapObject(grouped, function(val, key) { 
            var obj = {};
            obj.id = key;
            obj.pill = val[0].pill;
            obj.course = results[0].course;
            obj.description = results[0].description;
            obj.dosage = _.map(val, function(obj) { return { time: obj.timestamp } });
            return obj;
        });

        var objArray = _.values(objectified);
        // console.log(JSON.stringify(op));
        return callback(null, objArray);
    });
    // connection.end();
}

pillbottle.add = function(userId, callback) {
    connection.beginTransaction(function(err) {
        if(err) {
            console.log(err);
            return callback('DB Error', null);
        }

        var qry = "INSERT INTO PillBottle (pill) VALUES (NULL)";
        connection.query(qry, function(error, results, fields) {
            if(error) {
                console.log(error);
                connection.rollback();
                return callback('DB Error', null);
            }
            var qry = "INSERT INTO UserPill SET ?";
            var insertId = results.insertId
            connection.query(qry, { userId: userId, pillBottleId: insertId }, function(error, results, fields) {
                if(error) {
                    console.log(error);
                    connection.rollback();
                    return callback('DB Error', null);
                }
                connection.commit(function(error) {
                    if(error) {
                        console.log(error);
                        connection.rollback();
                        return callback('DB Error', null);
                    }
                    callback(null, {id: insertId});
                })                
            });
        }) 
    })
}

module.exports = pillbottle