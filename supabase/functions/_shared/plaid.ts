export class PlaidFailure extends Error {
 constructor(public code:string,public status=503){super(code);}
}
export function plaidConfig(env:(name:string)=>string|undefined){
 const environment=env('PLAID_ENV')??'sandbox';
 if(environment!=='sandbox'&&environment!=='production')throw new PlaidFailure('PLAID_CONFIGURATION_ERROR');
 const client_id=env('PLAID_CLIENT_ID');
 const secret=environment==='sandbox'?env('PLAID_SANDBOX_SECRET'):(env('PLAID_PRODUCTION_SECRET')??env('PLAID_SECRET'));
 if(!client_id||!secret)throw new PlaidFailure('PLAID_CONFIGURATION_ERROR');
 return {environment,client_id,secret,baseUrl:'https://'+environment+'.plaid.com'};
}
export function nativeRedirect(env:(name:string)=>string|undefined){
 const raw=env('PLAID_IOS_REDIRECT_URI');
 if(!raw)throw new PlaidFailure('NATIVE_LINK_NOT_CONFIGURED');
 try {const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.hostname==='localhost')throw Error();return url.href;}catch{throw new PlaidFailure('NATIVE_LINK_NOT_CONFIGURED');}
}
export const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
export function reply(body:unknown,status=200){return Response.json(body,{status,headers:{...cors,'Cache-Control':'no-store'}});}
export function failure(error:unknown){const code=error instanceof PlaidFailure?error.code:'BANK_REQUEST_FAILED';const status=error instanceof PlaidFailure?error.status:503;console.error(JSON.stringify({event:'bank_request_failed',code}));return reply({error:'Bank request could not complete.',code},status);}
