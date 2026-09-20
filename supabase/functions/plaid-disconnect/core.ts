export async function revokeConnection({begin,remove,finish}:{begin:()=>Promise<{done:boolean;access_token?:string}>;remove:(token:string)=>Promise<void>;finish:()=>Promise<void>}) {
 const state=await begin();if(state.done)return {success:true};
 if(!state.access_token)throw new Error('Connection unavailable');
 await remove(state.access_token);await finish();return {success:true};
}
