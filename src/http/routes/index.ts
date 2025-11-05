import { FastifyInstance } from "fastify"
import { signIn } from "./auth/sign-in"
import { getProfile } from "./auth/get-profile"
import { signUp } from "./auth/sign-up"
import { updateUser } from "./user/update-user"
import { updateUserPassword } from "./user/update-user-password"
import { createPost } from "./blog/post/create-post"
import { createMedia } from "./blog/media/create-media"
import { listMedia } from "./blog/media/list-media"
import { listPublicPosts } from "./blog/post/list-public-posts"
import { searchPosts } from "./blog/post/search-posts"
import { getPost } from "./blog/post/get-post"
import { deletePost } from "./blog/post/delete-post"
import { listPost } from "./blog/post/list-posts"
import { getRelatedPosts } from "./blog/post/related-post"
import { editPost } from "./blog/post/edit-post"
import { getPostById } from "./blog/post/get-post-by-id"
import { trackPostView } from "./blog/post/track-post-view"
import { createUtmEvent } from "./analytics/utm/create-utm-event"
import { createUtmCampaign } from "./analytics/utm/create-utm-campaign"
import { createUtmMedium } from "./analytics/utm/create-utm-medium"
import { createUtmSource } from "./analytics/utm/create-utm-source"
import { listUtmEvents } from "./analytics/utm/list-utm-events"
import { getPostStats } from "./blog/post/metrics/get-post-stats"
import { getMetrics } from "./blog/post/metrics/get-metrics"

export async function routes(app: FastifyInstance) {
  //ROTA PARA AUTHENTICAÇÃO
  app.register(signIn)
  app.register(getProfile)
  app.register(signUp)

  //ROTAS DO USER
  app.register(updateUser)
  app.register(updateUserPassword)

  //ROTA DO POST
  //rota privadas
  app.register(createPost)
  app.register(listPost)
  app.register(deletePost)
  app.register(editPost)
  app.register(getPostById)
  //rotas publicas
  app.register(listPublicPosts)
  app.register(searchPosts)
  app.register(getPost)
  app.register(getRelatedPosts)
  app.register(trackPostView)
  //metricas
  app.register(getPostStats)
  app.register(getMetrics)

  //ANALYTICS
  app.register(createUtmEvent)
  app.register(createUtmCampaign)
  app.register(createUtmMedium)
  app.register(createUtmSource)
  app.register(listUtmEvents)

  //MEDIA
  app.register(createMedia)
  app.register(listMedia)
}
