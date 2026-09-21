import {plaidConfig,nativeRedirect,PlaidFailure} from '../_shared/plaid.ts';
export async function createLinkToken(userId:string,body:unknown,env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new PlaidFailure('INVALID_REQUEST',400);
 const platform=(body as {platform?:unknown}).platform??'web';if(platform!=='web'&&platform!=='ios')throw new PlaidFailure('INVALID_REQUEST',400);
 const config=plaidConfig(env);const redirect=platform==='ios'?nativeRedirect(env):undefined;
 const response=await request(config.baseUrl+'/link/token/create',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({client_id:config.client_id,secret:config.secret,client_name:'Budget Live',language:'en',country_codes:['US'],products:['transactions'],user:{client_user_id:userId},...(redirect?{redirect_uri:redirect}:{})})});
 if(!response.ok)throw new PlaidFailure('PLAID_LINK_UNAVAILABLE',502);
 const data=await response.json();if(typeof data.link_token!=='string'||!data.link_token.startsWith('link-'))throw new PlaidFailure('PLAID_LINK_UNAVAILABLE',502);
 return {link_token:data.link_token,expiration:typeof data.expiration==='string'?data.expiration:null};
}
