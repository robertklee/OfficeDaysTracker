import { handleApiRequest, type Env as ApiEnv } from './api';

interface Env extends ApiEnv {
  ASSETS: Fetcher;
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
