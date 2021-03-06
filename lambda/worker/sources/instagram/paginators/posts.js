'use strict';

const _ = require('lodash');

const mediaChildren = require('./media_children');

const count = 1;

const fields = [
	'id',
	'caption',
	'timestamp',
	'media_type',
	'media_url',
	'permalink',
	'thumbnail_url'
];


function call(connection, parameters, headers, results, db) {
	let next, nextAfter, self = this;

	let outgoingHeaders = headers || {};
	let outgoingParameters = parameters || {};

	outgoingHeaders['X-Connection-Id'] = connection.remote_connection_id.toString('hex');

	outgoingParameters.fields = fields.join(',');
	outgoingParameters.limit = count;

	if (_.get(connection, 'endpoint_data.posts.after') != null && outgoingParameters.after == null) {
		outgoingParameters.after = connection.endpoint_data.posts.after;
	}

	return Promise.all([
		this.api.endpoint(this.mapping)({
			headers: outgoingHeaders,
			parameters: outgoingParameters
		}),

		this.api.endpoint(this.mapping + 'Page')({
			headers: outgoingHeaders,
			parameters: outgoingParameters
		})
	])
		.then(function([dataResult, pageResult]) {
			let [data, response] = dataResult;
			let [pageData, pageResponse] = pageResult;

			if (!(/^2/.test(response.statusCode))) {
				console.log(response);

				let body;

				try {
					body = response.body != null ? JSON.parse(response.body) : null;
				} catch(err) {
					console.log('Error parsing response body');
					console.log(err);

                    body = {};
				}

				return Promise.reject(new Error('Error calling ' + self.name + ': ' + response.statusCode === 504 ? 'Bad Gateway' : body != null ? body.message : 'Dunno, check response'));
			}

			if (results == null) {
				results = [];
			}

			next = pageData.next;
			nextAfter = pageData && pageData.cursors && pageData.cursors.after ? pageData.cursors.after : null;

			if (!self.subPaginate) {
				self.subPaginate = mediaChildren;
			}

			let pagePromises = _.map(data, async function(item) {
				if (item.media_type === 'CAROUSEL_ALBUM') {
					let parameters = {
						id: item.id
					};

					return self.subPaginate(connection, parameters, {}, [], db)
						.then(function(children) {
							item.children = children;

							return Promise.resolve(item);
						})
				}
				else {
					return Promise.resolve(item);
				}
			});

			return Promise.all(pagePromises);
		})
		.then(function(massResults) {
			if (results == null) {
				results = [];
			}

			_.each(massResults, function(individualResult) {
				results = results.concat(individualResult);
			});

			if (next != null) {
				return self.paginate(connection, {
					after: nextAfter
				}, {}, results, db);
			}
			else {
				let promise = Promise.resolve();

				if (results.length > 0 && nextAfter != null) {
					promise = promise.then(function() {
						return db.db('live').collection('connections').updateOne({
							_id: connection._id
						}, {
							$set: {
								'endpoint_data.posts.after': nextAfter
							}
						});
					});
				}

				return promise.then(function() {
					return Promise.resolve(results);
				});
			}
		})
		.catch(function(err) {
			console.log('Error calling Instagram Media:');
			console.log(err);

			return Promise.reject(err);
		});
}


module.exports = call;