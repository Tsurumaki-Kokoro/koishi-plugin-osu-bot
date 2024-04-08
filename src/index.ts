import { Context, Schema, h, segment } from 'koishi'
import {} from 'koishi-plugin-cron'
import axios from 'axios'

export const name = 'osu-bot'
export const inject = ['cron']

export interface Config {
  hitCircleUrl: string
  hitCirclePort: number
  apiKey: string
  clearCacheCron: string
}

// @ts-ignore
export const Config: Schema<Config> = Schema.object({
  hitCircleUrl: Schema.string().required().description("HitCircle API 地址"),
  hitCirclePort: Schema.number().required().description("HitCircle API 端口号"),
  apiKey: Schema.string().required().description("HitCircle! API Key"),
  clearCacheCron: Schema.union([
    '0 */12 * * *',
    '0 0 * * *',
    '0 0 * * 0',
    '0 0 1 * *',
  ]).role('').default('0 */12 * * *').description("清除缓存定时任务"),
})


export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh-CN', require('./locales/zh-CN'))
  const service = axios.create({
    baseURL: `http://${config.hitCircleUrl}:${config.hitCirclePort}`,
    timeout: 10000,
  })

  service.interceptors.request.use(
    (axiosConfig) => {
      const modifiedConfig = axiosConfig
      modifiedConfig.headers['access_token'] = config.apiKey
      return modifiedConfig
    },
    (error) => Promise.reject(error),
  );

  ctx.cron(config.clearCacheCron, async () => {
    try {
      await service.post('/task/clear_cache')
      ctx.logger.info('Cache cleared')
    } catch (e) {
      ctx.logger.warn(e)
    }
  })

  ctx.cron('5 0 * * *', async () => {
    try {
      await service.post('/task/update_user_info')
      ctx.logger.info('User info updated')
    } catch (e) {
      ctx.logger.warn(e)
    }
  })

  ctx.command('bind <username: text>', '绑定osu账号')
    .action(async ({ session }, username) => {
      let msg = ''
      try {
        const res = await service.post(
          '/users/bind',
          {
            osu_username: username,
            platform: session.event.platform,
            platform_uid: session.event.user.id,
          }
        )
        if (res.status === 200) {
          msg = username + session.text('.success') + session.username
        }
        if (session.platform === 'discord') {
          return msg
        } else {
          await session.send(h('quote', {id: session.messageId}, msg))
        }
      } catch (e) {
        ctx.logger.warn(e.response.data)
        if (e.response.status === 400) {
          msg = session.text('.invalidUser')
        } else if (e.response.status === 409) {
          msg = session.text('.alreadyBound')
        } else {
          ctx.logger.warn(e.response.data)
          msg = session.text('.error')
        }
        if (session.platform === 'discord') {
          return msg
        }
        await session.send(h('quote', {id: session.messageId}, msg))
      }
    })

  ctx.command('unbind', '解绑osu账号')
    .action(async ({ session }) => {
      let msg = ''
      try {
        const res = await service.post(
          '/users/unbind',
          {
            platform: session.event.platform,
            platform_uid: session.event.user.id,
          }
        )
        if (res.status === 200) {
          msg = session.text('.success')
        }
        if (session.platform === 'discord') {
          return msg
        } else {
          await session.send(h('quote', {id: session.messageId}, msg))
        }
      } catch (e) {
        if (e.response.status === 404) {
          msg = session.text('.notBound')
        } else {
          ctx.logger.warn(e.response.data)
          msg = session.text('.error')
        }
        if (session.platform === 'discord') {
          return msg
        }
        await session.send(h('quote', {id: session.messageId}, msg))
      }
    })

  ctx.command('mode <mode: integer>', '设置默认游戏模式')
    .action(async ({ session }, mode) => {
      let msg = ''
      let mode_str = ''
      try {
        const res = await service.post(
          '/users/update_mode',
          {
            platform: session.event.platform,
            platform_uid: session.event.user.id,
            game_mode: mode,
          }
        )
        switch (Number(mode)) {
          case 0:
            mode_str = 'osu!standard'
            break
          case 1:
            mode_str = 'osu!taiko'
            break
          case 2:
            mode_str = 'osu!catch'
            break
          case 3:
            mode_str = 'osu!mania'
            break
        }
        if (res.status === 200) {
          msg = session.text('.success') + mode_str
        }
        if (session.platform === 'discord') {
          return msg
        } else {
          await session.send(h('quote', {id: session.messageId}, msg))
        }
      } catch (e) {
        if (e.response.status === 404) {
          msg = session.text('.notBound')
        } else if (e.response.status === 422) {
          msg = session.text('.invalidMode')
        } else {
          ctx.logger.warn(e.response.data)
          msg = session.text('.error')
        }
        if (session.platform === 'discord') {
          return msg
        }
        await session.send(h('quote', {id: session.messageId}, msg))
      }
    })

  ctx.command('info [user: user]', '查询绑定的osu账号信息')
    .action(async ({ session }, user) => {
      const platform_uid = user ? user.split(':')[1] : session.event.user.id
      try {
        const res = await service.get(
          '/user_info',
          {
            params: {
              platform: session.event.platform,
              platform_uid,
            },
            responseType: 'arraybuffer'
          }
        )
        // 将ArrayBuffer转换为Base64编码的字符串
        const base64Image = Buffer.from(res.data).toString('base64');

        // 创建一个数据URI，包含Base64编码的图片数据
        const dataUri = `data:image/png;base64,${base64Image}`;

        // 使用segment.image发送图片
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 404) {
          return session.text('.notBound')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('recent [user: user] []', '查询最近(含 Failed)游玩记录')
    .option('mode', '-m [mode: integer]')
    .option('theme', '-t [theme: string]')
    .action(async ({ session, options }, user) => {
      const platform_uid = user ? user.split(':')[1] : session.event.user.id
      try {
        const res = await service.get(
          '/score/recent_play',
          {
            params: {
              platform: session.event.platform,
              platform_uid,
              game_mode: options.mode,
              include_fails: true,
              theme: options.theme,
            },
            responseType: 'arraybuffer'
          }
        )
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 404) {
          return session.text('.notBound')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('pr [user: user] []', '查询最近游玩记录')
    .option('mode', '-m [mode: integer]')
    .option('theme', '-t [theme: string]')
    .action(async ({ session, options }, user) => {
      const platform_uid = user ? user.split(':')[1] : session.event.user.id
      try {
        const res = await service.get(
          '/score/recent_play', {
          params: {
            platform: session.event.platform,
            platform_uid,
            game_mode: options.mode,
            include_fails: false,
            theme: options.theme,
          },
          responseType: 'arraybuffer',
        })
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 404) {
          return session.text('.notBound')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('bp <index: integer> [user: user]', '查询bp')
    .option('mode', '-m [mode: integer]')
    .option('theme', '-t [theme: string]')
    .action(async ({ session, options }, index, user) => {
      const platform_uid = user ? user.split(':')[1] : session.event.user.id
      try {
        const res = await service.get('/score/best_play', {
          params: {
            platform: session.event.platform,
            platform_uid,
            game_mode: options.mode,
            best_index: index,
            theme: options.theme,
          },
          responseType: 'arraybuffer',
        })
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 404) {
          return session.text('.notBound')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('score <beatmapId: integer> [user: user]', '查询单图成绩')
    .option('mods', '-md [mods: string]')
    .option('theme', '-t [theme: string]')
    .action(async ({ session, options }, beatmapId, user) => {
      const platform_uid = user ? user.split(':')[1] : session.event.user.id
      try {
        const res = await service.get('/score/user_score', {
          params: {
            platform: session.event.platform,
            platform_uid,
            beatmap_id: beatmapId,
            mods: options.mods,
            theme: options.theme,
          },
          responseType: 'arraybuffer',
        })
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 404) {
          return session.text('.notBound')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('map <beatmapId: integer>', '查询谱面信息')
    .option('theme', '-t [theme: string]')
    .action(async ({ session, options }, beatmapId) => {
      try {
        const res = await service.get('/beatmap/info', {
          params: {
            beatmap_id: beatmapId,
            theme: options.theme,
          },
          responseType: 'arraybuffer',
        })
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 400) {
          return session.text('.badRequest')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('bmap <beatmapSetId: integer>', '查询谱面集信息')
    .option('theme', '-t [theme: string]')
    .action(async ({ session, options }, beatmapSetId) => {
      try {
        const res = await service.get('/beatmap/info', {
          params: {
            beatmapset_id: beatmapSetId,
            theme: options.theme,
          },
          responseType: 'arraybuffer',
        })
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 400) {
          return session.text('.badRequest')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

  ctx.command('getbg <beatmapId: integer>', '获取谱面背景')
    .action(async ({ session }, beatmapId) => {
      try {
        const res = await service.get('/beatmap/cover', {
          params: {
            beatmap_id: beatmapId,
          },
          responseType: 'arraybuffer',
        })
        const base64Image = Buffer.from(res.data).toString('base64');
        const dataUri = `data:image/png;base64,${base64Image}`;
        return segment.image(dataUri);
      } catch (e) {
        if (e.response.status === 400) {
          return session.text('.badRequest')
        }
        ctx.logger.warn(e.response.data)
        return session.text('.error')
      }
    })

}
