import { handleApiRequest, type Env } from '../../server/api';

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleApiRequest(request, env);
