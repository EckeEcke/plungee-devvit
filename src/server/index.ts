import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createServer, getServerPort } from '@devvit/web/server'
import { api } from './routes/api'
import { menu } from './routes/menu'
import { triggers } from './routes/triggers'
import { scheduler } from './routes/scheduler'
import { community } from './routes/community'
import { data } from './routes/data'
import { moderation } from './routes/moderation'
import { trackPrivacyContext } from './core/privacy'

const app = new Hono()
app.use('/api/*', async (_c, next) => {
  await trackPrivacyContext()
  await next()
})
const internal = new Hono()
internal.route('/menu', menu)
internal.route('/triggers', triggers)
internal.route('/scheduler', scheduler)
app.route('/api', api)
app.route('/api', community)
app.route('/api', data)
app.route('/api/moderation', moderation)
app.route('/internal', internal)
serve({ fetch: app.fetch, createServer, port: getServerPort() })
