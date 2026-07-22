'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchEvents } = require('../src/services/elastic');

test('raw event search uses fixed indices, allowlisted fields, exact filters, and hard bounds', async t => {
  const previous = {
    url: process.env.ELASTICSEARCH_URL,
    key: process.env.ELASTIC_API_KEY,
    indices: process.env.ELASTIC_EVENT_INDICES,
  };
  t.after(() => {
    if (previous.url === undefined) delete process.env.ELASTICSEARCH_URL;
    else process.env.ELASTICSEARCH_URL = previous.url;
    if (previous.key === undefined) delete process.env.ELASTIC_API_KEY;
    else process.env.ELASTIC_API_KEY = previous.key;
    if (previous.indices === undefined) delete process.env.ELASTIC_EVENT_INDICES;
    else process.env.ELASTIC_EVENT_INDICES = previous.indices;
  });
  process.env.ELASTICSEARCH_URL = 'https://elastic.example:9200';
  process.env.ELASTIC_API_KEY = 'test-key';
  process.env.ELASTIC_EVENT_INDICES = 'logs-*';
  const calls = [];
  const request = async (url, body) => {
    calls.push({ url, body });
    return { hits:{ hits:[{
      _index:'logs-edr.endpoint-default', _id:'doc-1', fields:{
        '@timestamp':['2026-07-17T08:00:00Z'], 'event.id':['event-1'],
        'event.kind':['event'], 'event.dataset':['edr.endpoint'],
        'event.action':['prohibited-website-access'], 'user.name':['maya.georges'],
        'policy.violation':[true], 'policy.security_alert':[false],
      },
    }] } };
  };
  const events = await searchEvents({
    username:'maya.georges', policy_violation:true, hours:999, limit:999,
  }, { request });
  assert.equal(events[0].id, 'logs-edr.endpoint-default:doc-1');
  assert.equal(events[0].policy.security_alert, false);
  assert.match(calls[0].url, /\/logs-\*\/_search/);
  assert.equal(calls[0].body.size, 25);
  assert.deepEqual(calls[0].body.query.bool.filter[0], {
    range:{ '@timestamp':{ gte:'now-168h', lte:'now' } },
  });
  assert.ok(calls[0].body.fields.includes('policy.violation'));
  assert.equal(calls[0].body._source, false);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /query_string|script|runtime_mappings/);
});

test('raw event search rejects model-independent unsafe index configuration', async t => {
  const previous = {
    url: process.env.ELASTICSEARCH_URL,
    key: process.env.ELASTIC_API_KEY,
    indices: process.env.ELASTIC_EVENT_INDICES,
  };
  t.after(() => {
    if (previous.url === undefined) delete process.env.ELASTICSEARCH_URL;
    else process.env.ELASTICSEARCH_URL = previous.url;
    if (previous.key === undefined) delete process.env.ELASTIC_API_KEY;
    else process.env.ELASTIC_API_KEY = previous.key;
    if (previous.indices === undefined) delete process.env.ELASTIC_EVENT_INDICES;
    else process.env.ELASTIC_EVENT_INDICES = previous.indices;
  });
  process.env.ELASTICSEARCH_URL = 'https://elastic.example:9200';
  process.env.ELASTIC_API_KEY = 'test-key';
  process.env.ELASTIC_EVENT_INDICES = '../_all';
  await assert.rejects(
    searchEvents({ username:'maya.georges' }, { request:async () => ({}) }),
    /ELASTIC_EVENT_INDICES contains invalid characters/
  );
});
