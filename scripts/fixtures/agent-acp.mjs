import { Readable, Writable } from 'node:stream'
import {
  agent,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from '@agentclientprotocol/sdk'

let finishTurn
let authenticated = false
let sessionSequence = 0
const app = agent({ name: 'melo-test-agent' })
  .onRequest(methods.agent.initialize, () => {
    if (process.env.MELO_AGENT_FIXTURE === 'hang-init') return new Promise(() => {})
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'melo-test-agent', version: '1', _meta: { pid: process.pid } },
      agentCapabilities: { mcpCapabilities: { http: true } },
      authMethods: [{ id: 'gateway', name: 'Gateway' }],
    }
  })
  .onRequest(methods.agent.authenticate, ({ params }) => {
    if (params.methodId !== 'gateway') throw RequestError.invalidParams()
    authenticated = true
    return {}
  })
  .onRequest(methods.agent.session.new, () => {
    if (process.env.MELO_AGENT_FIXTURE === 'require-auth' && !authenticated)
      throw RequestError.authRequired()
    if (process.env.MELO_AGENT_FIXTURE === 'idle-eof') setTimeout(() => process.stdout.end(), 100)
    return { sessionId: `fixture-session-${++sessionSequence}` }
  })
  .onRequest(methods.agent.session.close, () => ({}))
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    if (params.configId !== 'model' || params.value !== 'fixture-model')
      throw RequestError.invalidParams()
    return {
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          type: 'select',
          currentValue: params.value,
          options: [{ value: params.value, name: 'Fixture model' }],
        },
      ],
    }
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const text = params.prompt.find((block) => block.type === 'text')?.text ?? ''
    if (text === 'crash') process.exit(17)
    if (text === 'permission') {
      const result = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: 'fixture-write', title: 'Write a file', kind: 'edit' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      })
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: result.outcome.outcome },
        },
      })
    } else {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      })
    }
    if (text === 'wait') return new Promise((resolve) => (finishTurn = resolve))
    return { stopReason: 'end_turn' }
  })
  .onNotification(methods.agent.session.cancel, () => {
    finishTurn?.({ stopReason: 'cancelled' })
  })

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
