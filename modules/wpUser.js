const request = require('request');

var l_module = exports.module = {};
var l_name = 'Module.wpUser';

const l_wpHost = SR.Settings.Project.hasOwnProperty('WORDPRESS_HOST') ?
	SR.Settings.Project.WORDPRESS_HOST : 'https://www.imoncloud.com';

//-----------------------------------------
// API definitions
//
//-----------------------------------------

SR.API.add('_wpGenerateAuthCookie', {
	username: 'string',
	password: 'string'
}, (args, onDone, extra) => {
	SR.API._wpGetNonce({}, (err, nonce) => {
		if (err) {
			onDone(err);
			return;
		}

		request.post(`${l_wpHost}/api/auth/generate_auth_cookie/`, {
			form: {
				nonce,
				username: args.username,
				password: args.password
			}
		}, (err, res, body) => {
			if (err) {
				onDone(err);
				return;
			}

			try {
				const result = JSON.parse(body);
				if (result.status === 'ok') {
					onDone(null, result);
				}

				if (result.status === 'error') {
					onDone(result.error);
				}
			} catch(e) {
				return onDone('failed to parse response body: ' + e);
			}
		})
	})
});

SR.API.add('_wpGetNonce', {}, (args, onDone, extra) => {
	request.get({
		url: `${l_wpHost}/api/get_nonce/?controller=auth&method=generate_auth_cookie`
	}, (err, res, body) => {
		if (err) {
			onDone(err);
			return;
		}

		try {
			const nonce = JSON.parse(body).nonce;
			return onDone(null, nonce);
		} catch(e) {
			return onDone('failed to parse response body: ' + e);
		}
	});
});

SR.API.add('_wpValidateAuthCookie', {
	cookie: 'string'
}, (args, onDone, extra) => {
	request.post(`${l_wpHost}/api/auth/validate_auth_cookie/`, {
		form: {
			cookie: args.cookie
		}
	}, (err, res, body) => {
		if (err) {
			onDone(err);
			return;
		}

		try {
			const valid = JSON.parse(body).valid;
			return onDone(null, valid);
		} catch(e) {
			return onDone('failed to parse response body: ' + e);
		}
	});
});

SR.API.add('_wpGetCurrentuserinfo', {
	cookie: 'string'
}, (args, onDone, extra) => {
	request.get({
		url: `${l_wpHost}/api/auth/get_currentuserinfo?cookie=${args.cookie}`
	}, (err, res, body) => {
		if (err) {
			onDone(err);
			return;
		}

		try {
			const user = JSON.parse(body).user;
			return onDone(null, user);
		} catch(e) {
			return onDone('failed to parse response body: ' + e);
		}
	});
});

//-----------------------------------------
// Server Event Handling
//
//-----------------------------------------

// module init
l_module.start = function (config, onDone) {
};

l_module.stop = function (onDone) {
};
