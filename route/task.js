// This file is part of Pa11y Webservice.
//
// Pa11y Webservice is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Pa11y Webservice is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Pa11y Webservice.  If not, see <http://www.gnu.org/licenses/>.

/* eslint camelcase: 'off' */
'use strict';

const {green, grey, red} = require('kleur');
const Joi = require('joi');
const {isValidAction} = require('pa11y');

// Routes relating to individual tasks
module.exports = function(app) {
	const model = app.model;
	const server = app.server;

	// Get a task
	server.route({
		method: 'GET',
		path: '/tasks/{id}',
		handler: async (request, reply) => {
			const task = await model.task.getById(request.params.id);

			if (!task) {
				return reply.response('Not Found').code(404);
			}

			if (request.query.lastres) {
				const results = await model.result.getByTaskId(task.id, {
					limit: 1,
					full: true
				});
				if (!results) {
					return reply.response().code(500);
				}
				task.last_result = null;
				if (results.length) {
					task.last_result = results[0];

					const skips = await model.skip.getByTaskId(request.params.id, request.query);
					if (skips) {
						results[0].skips = skips;
					}

				}
			}

			return reply.response(task).code(200);
		},
		options: {
			validate: {
				query: Joi.object({
					lastres: Joi.boolean()
				}),
				payload: false
			}
		}
	});

	// Edit a task
	server.route({
		method: 'PATCH',
		path: '/tasks/{id}',
		handler: async (request, reply) => {
			const task = await model.task.getById(request.params.id);

			if (!task) {
				return reply.response('Not Found').code(404);
			}

			if (request.payload.actions && request.payload.actions.length) {
				for (let action of request.payload.actions) {
					if (!isValidAction(action)) {
						return reply.response(`Invalid action: "${action}"`).code(400);
					}
				}
			}
			const updateCount = await model.task.editById(task.id, request.payload);
			if (updateCount < 1) {
				return reply.response().code(500);
			}
			const taskAgain = await model.task.getById(task.id);
			return reply.response(taskAgain).code(200);
		},
		options: {
			validate: {
				query: Joi.object({}),
				payload: Joi.object({
					name: Joi.string().required(),
					scanSitemap: Joi.boolean(),
					timeout: Joi.number().integer(),
					wait: Joi.number().integer(),
					ignore: Joi.array(),
					actions: Joi.array().items(Joi.string()),
					comment: Joi.string(),
					username: Joi.string().allow(''),
					password: Joi.string().allow(''),
					hideElements: Joi.string().allow(''),
					headers: [
						Joi.string().allow(''),
						Joi.object().pattern(/.*/, Joi.string().allow(''))
					]
				})
			}
		}
	});

	// Delete a task
	server.route({
		method: 'DELETE',
		path: '/tasks/{id}',
		handler: async (request, reply) => {
			const task = await model.task.deleteById(request.params.id);
			if (!task) {
				return reply.response('Not Found').code(404);
			}

			const removed = await model.result.deleteByTaskId(request.params.id);
			if (!removed) {
				return reply.response().code(500);
			}
			return reply.response().code(204);
		},
		options: {
			validate: {
				query: Joi.object({}),
				payload: false
			}
		}
	});

	// Run a task
	server.route({
		method: 'POST',
		path: '/tasks/{id}/run',
		handler: async (request, reply) => {
			console.log("Run"+request.params.id);
			const task = await model.task.getById(request.params.id);

			if (!task) {
				return reply.response('Not Found').code(404);
			}

			console.log(grey('Starting NEW to run one-off task @ %s'), new Date());
			//const executed = await model.task.runById(request.params.id);
			const executed = model.task.runById(request.params.id);

			// if (executed) {
			// 	console.log(green('Finished NEW task %s'), task.id);
			// } else {
			// 	console.log(
			// 		red('Failed to finish task %s'),
			// 		task.id
			// 	);
			// 	return reply.response(`Failed to finish task ${task.id}`).code(500);
			// }
			console.log(
				grey('Kicked running one-off task @ %s'),
				new Date()
			);
			return reply.response().code(202);
		},
		options: {
			validate: {
				query: Joi.object({})
			}
		}
	});

	// Get latest results for a task
	server.route({
		method: 'GET',
		path: '/tasks/{id}/results',
		handler: async (request, reply) => {
			const task = await model.task.getById(request.params.id);
			if (!task) {
				return reply.response('Not Found').code(404);
			}

			//get the results for the task
			const results = await model.result.getByTaskId(request.params.id, request.query);
			if (!results) {
				return reply.response('No results found for task').code(500);
			}

			//get the skipped elements for the task
			const skips = await model.skip.getByTaskId(request.params.id, request.query);
			
			console.log(skips);
			if (skips.length) {
				console.log("yes skips");
				results[0].skips = skips;
			} else {
				console.log("no skips");
			}

			return reply.response(results).code(200);
		},
		options: {
			validate: {
				query: Joi.object({
					from: Joi.string().isoDate(),
					to: Joi.string().isoDate(),
					full: Joi.boolean()
				}),
				payload: false
			}
		}
	});

	// Get a result for a task
	server.route({
		method: 'GET',
		path: '/tasks/{tid}/results/{rid}',
		handler: async (request, reply) => {
			const rid = request.params.rid;
			const tid = request.params.tid;
			const result = await model.result.getByIdAndTaskId(rid, tid, request.query);

			if (!result) {
				return reply.response('Not Found').code(404);
			}


			//get the skipped elements for the task
			const skips = await model.skip.getByTaskId(tid, request.query);
			if (skips) {
				result.skips = skips;
			}

			
			return reply.response(result).code(200);
		},
		options: {
			validate: {
				query: Joi.object({
					full: Joi.boolean()
				}),
				payload: false
			}
		}
	});

	// Get skipped elements for a task
	server.route({
		method: 'GET',
		path: '/tasks/{id}/skips',
		handler: async (request, reply) => {
			const task = await model.task.getById(request.params.id);
			if (!task) {
				return reply.response('Not Found').code(404);
			}

			const skips = await model.skip.getByTaskId(request.params.id, request.query);
			if (!skips) {
				return reply.response('No skipped elements found for task').code(500);
			}
			return reply.response(skips).code(200);
		},
		options: {
			validate: {
				query: Joi.object({
					from: Joi.string().isoDate(),
					to: Joi.string().isoDate(),
					full: Joi.boolean()
				}),
				payload: false
			}
		}
	});


	// Create a skipped element for a task
	server.route({
		method: 'POST',
		path: '/tasks/{id}/skips',
		handler: async (request, reply) => {
			//confirm task exists
			console.log("/tasks/{id}/skips");
			
			const task = await model.task.getById(request.params.id);
			if (!task) {
				console.log("No task with id"+request.params.id);
				return reply.response('Not Found').code(404);
			}

			request.payload.task = request.params.id;

			const skip = await model.skip.create(request.payload);

			if (!skip) {
				return reply.response().code(500);
			}

			return reply.response()
				.header('Location', `http://${request.info.host}/tasks/${request.params.id}`)
				.code(201);
		},
		options: {
			validate: {
				query: Joi.object({}),
				payload: Joi.object({
					code: Joi.string().required(),
					url: Joi.string().required(),
					selector: Joi.string().required(),
					context: Joi.string().required(),
					reason: Joi.string().required(),
					description: Joi.string().required(),
					skipAllPages: Joi.boolean(),
					headers: [
						Joi.string().allow(''),
						Joi.object().pattern(/.*/, Joi.string().allow(''))
					]
				})
			}
		}
	});


	// Get a skipped element
	// Edit a skipped element
	// Remove a skipped element

};
