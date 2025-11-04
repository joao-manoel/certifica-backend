import { FastifyInstance } from "fastify"
import { signIn } from "./auth/sign-in"
import { getProfile } from "./auth/get-profile"
import { signUp } from "./auth/sign-up"
import { updateUser } from "./user/update-user"
import { updateUserPassword } from "./user/update-user-password"
import { createPost } from "./blog/post/admin/create-post"
import { createMedia } from "./blog/media/create-media"
import { listMedia } from "./blog/media/list-media"
import { listPosts } from "./blog/post/list-posts"
import { searchPosts } from "./blog/post/search-posts"
import { getPost } from "./blog/post/get-post"
import { deletePost } from "./blog/post/admin/delete-post"
import { adminListPost } from "./blog/post/admin/list-posts"
import { getRelatedPosts } from "./blog/post/related-post"
import { editPost } from "./blog/post/admin/edit-post"
import { getPostById } from "./blog/post/admin/get-post-by-id"
import { trackPostView } from "./blog/post/track-post-view"

export async function routes(app: FastifyInstance) {
  //ROTA PARA AUTHENTICAÇÃO
  app.register(signIn)
  app.register(getProfile)
  app.register(signUp)

  //ROTAS DO USER
  app.register(updateUser)
  app.register(updateUserPassword)

  //ROTA DO POST
  app.register(createPost)
  app.register(listPosts)
  app.register(adminListPost)
  app.register(searchPosts)
  app.register(getPost)
  app.register(deletePost)
  app.register(getRelatedPosts)
  app.register(trackPostView)
  app.register(editPost)
  app.register(getPostById)

  //MEDIA
  app.register(createMedia)
  app.register(listMedia)
}
