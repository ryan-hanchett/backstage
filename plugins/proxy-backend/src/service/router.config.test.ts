/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  HostDiscovery,
  loggerToWinstonLogger,
} from '@backstage/backend-common';
import {
  ConfigSources,
  MutableConfigSource,
  StaticConfigSource,
} from '@backstage/config-loader';
import express from 'express';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { createRouter } from './router';
import { mockServices } from '@backstage/backend-test-utils';

// this test is stored in its own file to work around the mocked
// http-proxy-middleware module used in the main test file

describe('createRouter reloadable configuration', () => {
  const server = setupServer(
    rest.get('https://non-existing-example.com/', (req, res, ctx) =>
      res(
        ctx.status(200),
        ctx.json({
          url: req.url.toString(),
          headers: req.headers.all(),
        }),
      ),
    ),
  );

  beforeAll(() =>
    server.listen({
      onUnhandledRequest: ({ headers }, print) => {
        if (headers.get('User-Agent') === 'supertest') {
          return;
        }
        print.error();
      },
    }),
  );

  afterAll(() => server.close());
  afterEach(() => server.resetHandlers());

  it('should be able to observe the config', async () => {
    const logger = loggerToWinstonLogger(mockServices.logger.mock());

    // Grab the subscriber function and use mutable config data to mock a config file change
    const mutableConfigSource = MutableConfigSource.create({ data: {} });
    const config = await ConfigSources.toConfig(
      ConfigSources.merge([
        StaticConfigSource.create({
          data: {
            backend: {
              baseUrl: 'http://localhost:7007',
              listen: {
                port: 7007,
              },
            },
            proxy: {
              endpoints: {
                '/test': {
                  target: 'https://non-existing-example.com',
                  pathRewrite: {
                    '.*': '/',
                  },
                },
              },
            },
          },
        }),
        mutableConfigSource,
      ]),
    );

    const discovery = HostDiscovery.fromConfig(config);
    const router = await createRouter({
      config,
      logger,
      discovery,
    });
    expect(router).toBeDefined();

    const app = express();
    app.use(router);

    const agent = request.agent(app);
    // this is set to let msw pass test requests through the mock server
    agent.set('User-Agent', 'supertest');

    const response1 = await agent.get('/test');

    expect(response1.status).toEqual(200);

    mutableConfigSource.setData({
      proxy: {
        endpoints: {
          '/test2': {
            target: 'https://non-existing-example.com',
            pathRewrite: {
              '.*': '/',
            },
          },
        },
      },
    });

    const response2 = await agent.get('/test2');

    expect(response2.status).toEqual(200);
  });
});
