/*
//  execute.js
//
// handling all server start/stop functions & related display issues
//
// 2013-08-20	copied from app_conn.js
//
// relies on:
//   SR.AppConn

	functions:
		start(server_info, size, onDone, onOutput)			// start a certain number (size) of servers of a particular type
		stop(list, onDone)									// shutdown a given or a number of servers
		query(server_info, onDone)							// get a list of currently started/recorded servers

*/

var l_name = 'SR.Execute';

const spawn = require('child_process').spawn;	// for starting servers

// convert raw binary to string
// ref: http://stackoverflow.com/questions/12121775/convert-buffer-to-utf8-string
var StringDecoder = require('string_decoder').StringDecoder;		
var decoder = new StringDecoder('utf8');

//-----------------------------------------
// define local variables
//
//-----------------------------------------

// load system states (to store / load currently running servers)
//var l_states = SR.State.get(SR.Settings.DB_NAME_SYSTEM);

// map for pending app server deletions
var l_pendingDelete = {};

// map for pending app server starts
var l_pendingStart = [];

// map for process ID to server info
var l_id2server = {};

// map of successfully started processes (to be associated with the app server info)
var l_started = {};

// map of reported app servers
//var l_servers = {};

//-----------------------------------------
// define local function
//
//-----------------------------------------


//-----------------------------------------
// define external function
//
//-----------------------------------------

// start a certain number (size) of servers of a particular type
// server_info include:
// { owner:  'string',
//   project: 'string',
//   name:    'string'}
// NOTE: path needs to be relative to the executing environment, which is where the calling frontier resides
/// SR-API
/// SR.Execute.start 
/// start a certain number (size) of servers of a particular type
/// Input
///   server_info 
///     {owner: 'aether', project: 'BlackCat', name: 'lobby'}    
///     what kind of server to start      
///     object         
///   size    
///     1   
///     how many servers to start        
///     number                       
/// Output                                    
///   onDone                  
///   onOutput 
var l_start = exports.start = function (server_info, size, onDone, onOutput) {

	var errmsg;
	if (SR.Settings.hasOwnProperty('SERVER_INFO') === false) {
		errmsg = 'SR.Settings.SERVER_INFO not set';
		LOG.error(errmsg, 'SR.Execute');
		return UTIL.safeCall(onDone, errmsg);
	}
	
	// force convert parameter
	if (typeof size === 'string')
		size = parseInt(size);
	
	// construct server_info (if not provided, use default value in SERVER_INFO)		
	server_info.owner   = server_info.owner   || SR.Settings.SERVER_INFO.owner;
	server_info.project = server_info.project || SR.Settings.SERVER_INFO.project;
	
	LOG.warn('start ' + size + ' server(s), info: ', 'SR.Execute');
	LOG.warn(server_info, 'SR.Execute');
	
	// if no owner / project specified, use default value in SERVER_INFO
	if (server_info.owner === undefined || server_info.project === undefined || server_info.name === undefined) {
		errmsg = 'server_info incomplete';
		LOG.error(errmsg, 'SR.Execute');
		return UTIL.safeCall(onDone, errmsg);
	}

	// build path, first try relative, then try absolute
	var valid_path = false;
	
	var path = '.' + SR.Settings.SLASH;
	var frontier_path = path + server_info.name + SR.Settings.SLASH + 'frontier.js';
	var log_path = path + 'log' + SR.Settings.SLASH + 'screen.out';

	LOG.warn('relative frontier path: ' + frontier_path, 'SR.Execute');
	
	if (SR.fs.existsSync(frontier_path) === false) {
		path = SR.Settings.PATH_USERBASE + server_info.owner + SR.Settings.SLASH + server_info.project + SR.Settings.SLASH;
		frontier_path = path + server_info.name + SR.Settings.SLASH + 'frontier.js';
		LOG.warn('absolute frontier path: ' + frontier_path, 'SR.Execute');
		if (SR.fs.existsSync(frontier_path) === true)
			valid_path = true;
	}
	else
		valid_path = true;

	// check if frontier file exists
	if (valid_path === false) {
		errmsg = 'frontier not found: ' + frontier_path;
		LOG.error(errmsg, 'SR.Execute');
		return UTIL.safeCall(onDone, errmsg);
	}
	
	// store starting path
	server_info.exec_path = path;
	
	var server_type = server_info.owner + '-' + server_info.project + '-' + server_info.name;
	LOG.warn('starting ' + size + ' [' + server_type + '] servers', 'SR.Execute');
	
	var existing_count = 0;

	// for app servers, get how many app servers of a given name is already started	
	if (server_info.name !== 'lobby')
		existing_count = Object.keys(SR.AppConn.queryAppServers(server_info.name)).length;
	
	LOG.warn('there are ' + existing_count + ' existing [' + server_type + '] servers', 'SR.Execute');

	// store an entry for the callback when all servers are started as requested
	// TODO: if it takes too long to start all app servers, then force return in some interval
	l_pendingStart.push({
		onDone: onDone,
		total: size,
		curr: 0,
		server_type: server_type,
		servers: []
	});
	
	// notify if a server process has started
	var onStarted = function (id) {
					  
		LOG.warn('server started: ' + server_type, 'SR.Execute');
    
		// check if we should notify start server request
		for (var i=0; i < l_pendingStart.length; i++) {
		
			var task = l_pendingStart[i];
		
			LOG.warn('pending type: ' + task.server_type, 'SR.Execute');
			if (task.server_type === server_type) {
									
				// record server id, check for return
				task.servers.push(id);
				task.curr++;
				
				// store this process id
				if (l_started.hasOwnProperty(server_type) === false)
					l_started[server_type] = [];
				
				// NOTE: we currently do not maintain this id, should we?
				//l_started[server_type].push(id);
				
				// check if all servers of a particular type are started
				if (task.curr === task.total) {
					UTIL.safeCall(task.onDone, task.servers);
					
					// remove this item until app servers have also reported back
					l_pendingStart.splice(i, 1);
				}
				break;
			}
		}
	}
	
	// start executing
	var count = 0;
	var start_server = function () {
	
		count++;
		existing_count++;
		var name = server_type + existing_count;
		LOG.warn('starting [' + server_type + '] Server #' + count + ' ' + name, 'SR.Execute');
			
		var id = UTIL.createToken();			
		l_run(id, server_info, onStarted, onOutput);

		// see if we should keep starting server, or should return
		if (count < size)
			setTimeout(start_server, 100);
	};
	
	start_server();	
}


// shutdown a given or a number of servers               
/// SR-API                     
/// SR.Execute.stop     
/// stop the execution of some servers given server IDs 
 /// Input                   
///   list    
///     ['684D846B-FE39-4506-A19A-F50D0FEFA088', '22C163AE-2E35-4219-AAD1-EA961077B2E2']       
///     array for server's unique ID list 
///     array            
/// Output                                   
///   onDone 
var l_stop = exports.stop = function (list, onDone) {

	// first check if it's just a single server
	if (typeof list === 'string' && list !== '')
		list = [list];
	
	// check if list exist or compose a list made of all currently registered apps servers
	else if (typeof list === 'undefined' || list.length === 0) {
		list = [];
		var servers = SR.AppConn.queryAppServers();
		for (var id in servers)
			list.push(id);
	}

	LOG.warn('attempt to stop ' + list.length + ' servers in total', 'SR.Execute');
	LOG.warn(list);
	
    // send shutdown signal
	var shut_count = 0;
    for (var i = 0; i < list.length; i++) {
		var id = list[i];
		LOG.warn('id: ' + id, 'SR.Execute');
		
		// check if this is process_id and needs translation to serverID
		if (l_id2server.hasOwnProperty(id))
			id = l_id2server[id];
			
		var stat = undefined;
		
		// get server info
		SR.Call('reporting.getStat', id, function (list) {
			if (list.length === 0) {
				LOG.warn('server info for id [' + id + '] does not exist', 'SR.Execute');				
				return;
			}
			stat = list[0];
			
			LOG.warn('info for server to be shutdown: ', 'SR.Execute');
			LOG.warn(stat, 'SR.Execute');
			
			shut_count++;
					
			// check if server to be shutdown is a lobby
			// TODO: have a more unified approach?
			if (stat.type === 'app') {
				
				// record id to list of pending deletion
				l_pendingDelete[id] = true;
			
				// to shutdown app servers, notify the app server directly
				SR.AppConn.sendApp(id, 'APP_SHUTDOWN', {});			
			}
			else {
				
				var info = stat;
				var url = 'http://' + info.IP + ':' + (info.port + SR.Settings.PORT_INC_HTTP) + '/stop/self';
				LOG.warn('stop a lobby, url: ' + url, 'SR.Execute');
				UTIL.HTTPget(url, function () {
					LOG.warn('stop lobby HTTP request done', 'SR.Execute');
				});
			}
		});		
	}
	
	UTIL.safeCall(onDone, shut_count + ' servers shutdown');
}

// get a list of currently started/recorded servers
// server_info include:
// { owner:  'string',
//   project: 'string',
//   name:    'string'}
// NOTE: path needs to be relative to the executing environment, which is where the calling froniter resides                
/// SR-API                   
/// SR.Execute.query          
/// get a list of currently started and live servers                     
/// Input                   
///   server_info  
///     {owner: 'aether', project: 'BlackCat', name: 'lobby'}    
///     what kind of server to query (can be partial, will return the largest set of matched servers)  
///     object                
/// Output                  
///   onDone   
///     [{"server":{"id":"7FA39AA9-63B8-423C-BBE9-A3D38405240B","owner":"aether","project":"BlackCat","name":"lobby","type":"lobby","IP":"211.78.245.176","port":37000},"admin":"shunyunhu@gmail.com","reportedTime":"2014-06-03T10:25:27.779Z"}] 
///     returns a list of currently live servers    
var l_query = exports.query = function (server_info, onDone) {
	
	SR.Call('reporting.getStat', server_info, function (list) {
		UTIL.safeCall(onDone, list);	
	});
}

// 以下可自動關閉/啟動全部正在執行的 project servers: 
// 可手動 stopall 關閉, startall 啟動 (包含 lobby, apps 及自行手動 ./run lobby 的)
// 目前已知問題: 
// 	1) 手動 stopall 之後，馬上下 query 還可以看見未關閉前的 project server 集合, 如果又馬上 quit, 則下次重新啟動 monitor 會自動啟動的是 stopall 前的集合，而不是空集合 
//	2) owner: 'aether', project: 'BlackCat', name: 'catfruit_silver' 本身不能被 quit ; 因此像這類關不掉的 app server 可能會「越開越多」, 此外，對於「關不掉」的 project server 而言，若當初是用 bash 開啟的，則可以強制 kill, 但若是用 monitor 開啟的，就要小心刪 process 
//	3) 若有多個 app servers，將來 startall 之後，有可能只會被開一個
//	4) 不在 SR-project 標準路徑的 $SR_PATH 將來 startall 無法自動啟動

// restart all servers previously running
var l_startAll = exports.startAll = function () {
	
    // restart stopped server
	SR.DB.getData(SR.Settings.DB_NAME_SYSTEM, {},
		function (re) {
			
			var servers = re.allservers;
			
            LOG.warn(servers, 'SR.Execute');
            for (var c in servers) {
				if (servers[c].server.type === 'entry')
					continue;
				
                var obj = { owner: servers[c].server.owner, 
                            project: servers[c].server.project,
                            name: servers[c].server.name
                        };
				
                l_start(obj, 1, function (re){
                        //LOG.warn('The project server is started.', 'SR.Execute');
                        //LOG.warn(obj, 'SR.Execute');
                    }, function (re){
                        //LOG.warn('The project server is not started.', 'SR.Execute');
                        //LOG.warn(obj, 'SR.Execute');
                    });
            }
        }, 
        function (re) {
			LOG.warn('DB read error', 'SR.Execute');
		});
};

// stop all servers and record to DB currently executing servers
var l_stopAll = exports.stopAll = function () {
	
    // save and stop all running servers
	l_query({}, function (allServers) {
		
		for (var c in allServers) {
			if (allServers[c].server.type === 'entry')
				delete allServers[c];
		}
				
        SR.DB.setData(SR.Settings.DB_NAME_SYSTEM, {'allservers': allServers});
        LOG.warn('I am going to shut all servers.', 'SR.Execute');
	    for (var c in allServers) {
	        LOG.warn(allServers[c].server.id, 'SR.Execute');
	        l_stop(allServers[c].server.id);
    	}
    });
};


// notify a particular server is started
// TODO: check correctness based on info
/*
info: {
	owner: 'string',
	project: 'string',
	name: 'string',
	type: 'string',
	IP: 'string',
	port: 'number'
}
*/

// record server info (IP & port) when server starts
SR.Callback.onAppServerStart(function (info) {
	//LOG.warn('an app server has started:', 'SR.Execute');
	//LOG.warn(info);
	
	// store server info to SR.Report (so app server info is stored consistently regardless at lobby or monitor)
	//SR.Report.storeStat({server: info});	

	var server_type = info.owner + '-' + info.project + '-' + info.name;
	if (l_started.hasOwnProperty(server_type)) {
		var id_list = l_started[server_type];

		// try to associate a process id with a started app server
		// NOTE: this process is independent of when a specific number of processes have started and onDone is called
		if (id_list.length > 0) {
			l_id2server[id_list[0]] = info.id;
			
			LOG.warn('server [' + server_type + '] was started with process id: ' + id_list[0], 'SR.Execute');
			
			// remove process id
			id_list.splice(0, 1);
			return;
		}
	}
	else {
		LOG.warn('server [' + server_type + '] was started manually, cannot terminate it with process id', 'SR.Execute');
	}
	
});

SR.Callback.onAppServerStop(function (info) {
	//LOG.warn('an app server has stopped:', 'SR.Execute');
	//LOG.warn(info, 'SR.Execute');
	
	LOG.warn('removing pending delete record for server [' + info.id + ']', 'SR.Execute');
	
	// delete pending requests for app server deletion
	delete l_pendingDelete[info.id];
	
	// remove server info in SR.Report
	//SR.Report.removeStat(info.id);
	
});

// run a single server instance
// id:	unique id for this process
// info: {
//		owner: 'string',
//		project: 'string',
//		name: 'string'
//		exec_path: 'string'
// }
// onDone notifies when the process is executed (with unique ID returned)
// onOutput notifies the output of the process execution
var l_run = exports.run = function (id, info, onDone, onOutput) {
	
	var exec_path = info.exec_path;
	var exec_name = info.owner + '-' + info.project + '-' + info.name;
	var log_path = exec_path;
	
	LOG.warn(info, 'SR.Execute');
	LOG.warn('exec_path: ' + exec_path, 'SR.Execute');
	LOG.warn('log_path: ' + log_path, 'SR.Execute');
	
	/* screen version
	var new_proc = spawn('screen', 
						 ['-m', '-d', '-S', info.name, '.' + SR.Settings.SLASH + 'run', info.name],
						 {cwd: exec_path}		
	*/
	
	var log_file = undefined;
	
	var onLogOpened = function () {
	
		// execute directly
		// TODO: execute under a given linux user id? (probably too complicated)
		var new_proc = spawn('.' + SR.Settings.SLASH + 'run',
							 [info.name],
							 {cwd: exec_path}
		);
		
		var onStdData = function (data) {

			// convert to utf8 text chunk
 	 	    var textChunk = decoder.write(data);
    
			// write output to log file under the project's log directory
			if (log_file) {
				log_file.write(textChunk);
			}

			// notify callback of output messages
			if (typeof onOutput === 'function') {
    				
				// store data as an output message
				var msg = {
					id: id,
					data: textChunk
				}
                UTIL.safeCall(onOutput, msg);
			}
		}
		
		// log screen output & re-direct
		new_proc.stdout.setEncoding('utf8');
		new_proc.stdout.on('data', function (data) {
			
			// notify the process run has been executed for once (but may or may not be successful)
			if (typeof onDone === 'function') {			
        		UTIL.safeCall(onDone, id);
				onDone = undefined;
			}
			
			onStdData(data);
		});
        	
		// print error if start fail
		new_proc.stderr.setEncoding('utf8');
		new_proc.stderr.on('data', function (data) {
  	  		if (/^execvp\(\)/.test(data)) {
				LOG.error('Failed to execute: ' + exec_name + ' path: ' + exec_path, 'SR.Execute');
  	  		}
			LOG.error(data, 'SR.Execute');		
			onStdData(data);
		});
		
		// NOTE: should we call some callback when process exits?
		new_proc.on('exit', function (code) {
			LOG.warn('program [' + exec_name + '] process exited with code ' + code, 'SR.Execute');
						
			if (log_file) {
				log_file.close(function () {
					log_file = undefined;
				});
			}
		});
	}
	
	// filename, onSuccess, onFail, to_cache
	// NOTE: why log_file is important here is because we want to capture ALL stdout output during starting a server
	// not just those the server writes by itself if executing successfully	
	log_file = new SR.File();
	//log_file.open(	id + '.log',
	log_file.open('output.log',
				  	onLogOpened, 
					function (e) {
						LOG.error('Failed to open log file: ' + exec_name, 'SR.Execute');
						LOG.error(e, 'SR.Execute');
					},
					false,
					log_path);
}