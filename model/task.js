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

/* eslint id-length: 'off' */
/* eslint no-catch-shadow: 'off' */
/* eslint no-underscore-dangle: 'off' */
/* eslint new-cap: 'off' */
'use strict';

const {grey} = require('kleur');
const {ObjectID} = require('mongodb');
const pa11y = require('pa11y');

const Sitemapper = require('sitemapper');
const _ = require('underscore');

// Task model
module.exports = function(app, callback) {
	app.db.collection('tasks', async function(errors, collection) {
		await collection.createIndex({
			name: 1,
			url: 1,
			standard: 1
		});
		const model = {

			collection: collection,

			// Create a task
			create: function(newTask) {
				newTask.headers = model.sanitizeHeaderInput(newTask.headers);

				return model.collection.insertOne(newTask)
					.then(result => {
						return model.prepareForOutput(result.ops[0]);
					})
					.catch(error => {
						console.error('model:task:create failed');
						console.error(error.message);
					});
			},

			// Get all tasks
			getAll: () => {
				return collection
					.find()
					.sort({
						name: 1,
						standard: 1,
						url: 1
					})
					.toArray()
					.then(tasks => {
						return tasks.map(model.prepareForOutput);
					})
					.catch(error => {
						console.error('model:task:getAll failed');
						console.error(error.message);
					});
			},

			// Get a task by ID
			getById: function(id) {
				try {
					id = new ObjectID(id);
				} catch (error) {
					console.error('ObjectID generation failed.', error.message);
					return null;
				}

				return collection.findOne({_id: ObjectID(id)})
					.then(task => {
						return model.prepareForOutput(task);
					})
					.catch(error => {
						console.error(`model:task:getById failed, with id: ${id}`);
						console.error(error.message);
						return null;
					});
			},

			// Edit a task by ID
			// with scanSitemap - NL
			editById: function(id, edits) {
				const idString = id;
				try {
					id = new ObjectID(id);
				} catch (error) {
					console.error('ObjectID generation failed.', error.message);
					return null;
				}
				const now = Date.now();
				const taskEdits = {
					name: edits.name,
					scanSitemap: edits.scanSitemap,
					timeout: parseInt(edits.timeout, 10),
					wait: parseInt(edits.wait, 10),
					actions: edits.actions,
					username: edits.username,
					password: edits.password
				};
				if (edits.ignore) {
					taskEdits.ignore = edits.ignore;
				}
				if (edits.hideElements) {
					taskEdits.hideElements = edits.hideElements;
				}
				if (edits.headers) {
					taskEdits.headers = model.sanitizeHeaderInput(edits.headers);
				}

				return collection.updateOne({_id: ObjectID(id)}, {$set: taskEdits})
					.then(updateCount => {
						if (updateCount < 1) {
							return 0;
						}
						const annotation = {
							type: 'edit',
							date: now,
							comment: edits.comment || 'Edited task'
						};
						return model.addAnnotationById(idString, annotation)
							.then(() => {
								return updateCount;
							});
					})
					.catch(error => {
						console.error(`model:task:editById failed, with id: ${id}`);
						console.error(error.message);
						return null;
					});
			},

			// Add an annotation to a task
			addAnnotationById: function(id, annotation) {
				return model.getById(id)
					.then(task => {
						if (!task) {
							return 0;
						}
						if (Array.isArray(task.annotations)) {
							return model.collection.updateMany({_id: ObjectID(id)}, {$push: {annotations: annotation}});
						}
						return model.collection.updateMany({_id: ObjectID(id)}, {$set: {annotations: [annotation]}});

					})
					.catch(error => {
						console.error(`model:task:addAnnotationById failed, with id: ${id}`);
						console.error(error.message);
						return null;
					});
			},

			// Delete a task by ID
			deleteById: function(id) {
				try {
					id = new ObjectID(id);
				} catch (error) {
					console.error('ObjectID generation failed.', error.message);
					return null;
				}
				return collection.deleteOne({_id: ObjectID(id)})
					.then(result => {
						return result ? result.deletedCount : null;
					})
					.catch(error => {
						console.error(`model:task:deleteById failed, with id: ${id}`);
						console.error(error.message);
						return null;
					});
			},

			// Run a task by ID
			// with scanSitemap - NL
			runById: function(id) {
				return model.getById(id).then(async task => {
					const pa11yOptions = {
						standard: task.standard,
						username: task.username,
						password: task.password,
						email: task.email,
						scanSitemap: task.scanSitemap,
						includeWarnings: true,
						includeNotices: true,
						timeout: (task.timeout || 30000),
						wait: (task.wait || 0),
						ignore: task.ignore,
						actions: task.actions || [],
						chromeLaunchConfig: app.config.chromeLaunchConfig || {},
						headers: task.headers || {},
						log: {
							debug: model.pa11yLog(task.id),
							error: model.pa11yLog(task.id),
							info: model.pa11yLog(task.id),
							log: model.pa11yLog(task.id)
						}
					};

					// eslint-disable-next-line dot-notation
					// if (task.username && task.password && !pa11yOptions.headers['Authorization']) {
					// 	const encodedCredentials = Buffer.from(`${task.username}:${task.password}`)
					// 		.toString('base64');

					// 	// eslint-disable-next-line dot-notation
					// 	pa11yOptions.headers['Authorization'] = `Basic ${encodedCredentials}`;
					// }

					if (task.hideElements) {
						pa11yOptions.hideElements = task.hideElements;
					}

					//If set to scan for sitemap, get URL list from sitemap
					if (pa11yOptions.scanSitemap) {

						//rebuild the Sitemap URL to a standard format
						let sitemapURL = new URL(task.url);
						sitemapURL = `${ sitemapURL.protocol }//${ sitemapURL.host }/sitemap.xml`;
						task.url = await model.getURLsFromSitemap(sitemapURL, task.username, task.password);
					}					


					//push page list to DB to track progress of URLs in scan
					let results = {};
					const pageList = app.model.result.urlsToPageList(task.url);
					results.pageList = pageList;
					results.task = task.id;
					results.ignore = task.ignore;

					//initial insert
					let response = await app.model.result.create(results);
					//console.log(response);
					let resultsID = response.id;

					//Run Pa11y and update status along the way
					let pa11yResults = [];
					pa11yResults.issues = [];

					if(Array.isArray(task.url)){
						console.log(`Multiple URLs found`);

						// Loop through the URL array - NL
						for(var url of task.url){

							//set page to in progress
							results.pageList.find(page => page.url === url).status = 'In Progress';
							response = await app.model.result.editById(resultsID, results);

							//run pa11y
							let URLResults = await pa11y(url, pa11yOptions);

							//set page to complete
							results.pageList.find(page => page.url === url).status = 'Complete';
							response = await app.model.result.editById(resultsID, results);							

							//merge Pa11y Runner results with existing results
					    pa11yResults.issues = pa11yResults.issues.concat(URLResults.issues);
							
						}

					} else {
						console.log(`Single URL found.`);
						let url = task.url;
						//set page to in progress
						results.pageList.find(page => page.url === url).status = 'In Progress';
						response = await app.model.result.editById(resultsID, results);

						//run pa11y
						pa11yResults = await pa11y(task.url, pa11yOptions);

						//set page to complete
						results.pageList.find(page => page.url === url).status = 'Complete';
						response = await app.model.result.editById(resultsID, results);						
					}

					console.log("pa11yResults complete");
					const issuesAndCount = app.model.result.convertPa11y2Results(pa11yResults);
					
					//merge with existing page list
					results = {...results,...issuesAndCount};

					response = await app.model.result.editById(resultsID, results);

					return response;

				})
					.catch(error => {
						console.error(`webservice:model:task:runById failed, with id: ${id}`);
						console.error(error.message);
						return null;
					});
			},

			// Prepare a task for output
			prepareForOutput: function(task) {
				if (!task) {
					return null;
				}
				const output = {
					id: task._id.toString(),
					name: task.name,
					url: task.url,
					timeout: (task.timeout ? parseInt(task.timeout, 10) : 30000),
					wait: (task.wait ? parseInt(task.wait, 10) : 0),
					standard: task.standard,
					ignore: task.ignore || [],
					actions: task.actions || []
				};
				//new NL
				if (task.scanSitemap) {
					output.scanSitemap = task.scanSitemap;
				}
				if (task.annotations) {
					output.annotations = task.annotations;
				}
				if (task.username) {
					output.username = task.username;
				}
				if (task.password) {
					output.password = task.password;
				}
				if (task.hideElements) {
					output.hideElements = task.hideElements;
				}
				if (task.headers) {
					if (typeof task.headers === 'string') {
						try {
							output.headers = JSON.parse(task.headers);
						} catch (error) {
							console.error('Header input contains invalid JSON:', task.headers);
							console.error(error.message);
						}
					} else {
						output.headers = task.headers;
					}
				}
				return output;
			},

			sanitizeHeaderInput: function(headers) {
				if (typeof headers === 'string') {
					try {
						return JSON.parse(headers);
					} catch (error) {
						console.error('Header input contains invalid JSON:', headers);
						console.error(error.message);
						return null;
					}
				}
				return headers;
			},

			pa11yLog: function(taskId) {
				return message => {
					let messageString;

					if (taskId) {
						messageString = `[${taskId}]  > ${message}`;
					} else {
						messageString = `  > ${message}`;
					}

					console.log(grey(messageString));
				};
			},

			getURLsFromSitemap: async function (url, username, password) {
				/**
				 * Returns a list of URLs from a given sitemap
				 * @private
				 * @param {String} url - The sitemap URL
				 * @returns {Array} Returns the an array of URLs.
				 */

				let sitemapperOptions = {
			    url: url,
			    timeout: 15000, // 15 seconds
			    debug: false
				};

				if (username && password) {
					
					const usernamePasswordBuffer = Buffer.from(
					  `${username}:${password}`,
					  "utf-8"
					);

					const base64UsernamePassword = usernamePasswordBuffer.toString("base64");

					sitemapperOptions.requestHeaders = {
					  'Authorization': `Basic ${base64UsernamePassword}`
					};
				}

			  const sitemap = new Sitemapper(sitemapperOptions);

			  
			  let urls = await sitemap.fetch();

			  //using underscore to reduce to only unique urls
			  urls = _.uniq(urls.sites);

			  //when debugging, limit to 3 urls
			  urls = urls.slice(0, 3);

				console.log(urls.length+" pages discovered on sitemap");
			  return urls;
				
			}			

		};
		callback(errors, model);
	});
};
