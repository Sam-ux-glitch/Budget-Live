/* eslint-disable @typescript-eslint/no-require-imports -- Node Xcode project generator. */
const fs=require('fs'); const crypto=require('crypto'); const xcode=require('xcode');
const path='ios/App/App.xcodeproj/project.pbxproj';const project=xcode.project(path);project.parseSync();const o=project.hash.project.objects;
const id=()=>crypto.randomBytes(12).toString('hex').toUpperCase();
const add=(section,obj)=>{const key=id();o[section]??={};o[section][key]=obj;return key;};
const ref=(value,comment)=>({value,comment});
const app='504EC3031FED79650016851F',root='504EC2FC1FED79650016851F';
if(!Object.values(o.PBXNativeTarget).some(t=>t.name==='BudgetWidget')){
 const widget=id();const sources=add('PBXSourcesBuildPhase',{isa:'PBXSourcesBuildPhase',buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0});
 const frameworks=add('PBXFrameworksBuildPhase',{isa:'PBXFrameworksBuildPhase',buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0});
 const resources=add('PBXResourcesBuildPhase',{isa:'PBXResourcesBuildPhase',buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0});
 const configs=['Debug','Release'].map(name=>ref(add('XCBuildConfiguration',{isa:'XCBuildConfiguration',name,buildSettings:{PRODUCT_BUNDLE_IDENTIFIER:'com.budgetlive.personal.widget',PRODUCT_NAME:'"$(TARGET_NAME)"',INFOPLIST_FILE:'BudgetWidget/Info.plist',CODE_SIGN_ENTITLEMENTS:'BudgetWidget/BudgetWidget.entitlements',APP_GROUP_ID:'group.com.budgetlive.personal',CODE_SIGN_STYLE:'Automatic',IPHONEOS_DEPLOYMENT_TARGET:'16.0',SWIFT_VERSION:'5.0',TARGETED_DEVICE_FAMILY:'"1,2"',SKIP_INSTALL:'YES',APPLICATION_EXTENSION_API_ONLY:'YES',MARKETING_VERSION:'0.2.0',CURRENT_PROJECT_VERSION:'1',LD_RUNPATH_SEARCH_PATHS:['"$(inherited)"','"@executable_path/Frameworks"','"@executable_path/../../Frameworks"']}}),name));
 const list=add('XCConfigurationList',{isa:'XCConfigurationList',buildConfigurations:configs,defaultConfigurationIsVisible:0,defaultConfigurationName:'Release'});
 const product=add('PBXFileReference',{isa:'PBXFileReference',explicitFileType:'"wrapper.app-extension"',includeInIndex:0,path:'BudgetWidget.appex',sourceTree:'BUILT_PRODUCTS_DIR'});
 o.PBXNativeTarget[widget]={isa:'PBXNativeTarget',name:'BudgetWidget',productName:'BudgetWidget',productType:'"com.apple.product-type.app-extension"',productReference:product,buildConfigurationList:list,buildPhases:[ref(sources,'Sources'),ref(frameworks,'Frameworks'),ref(resources,'Resources')],buildRules:[],dependencies:[]};
 o.PBXProject[root].targets.push(ref(widget,'BudgetWidget'));o.PBXGroup['504EC3051FED79650016851F'].children.push(ref(product,'BudgetWidget.appex'));
 const proxy=add('PBXContainerItemProxy',{isa:'PBXContainerItemProxy',containerPortal:root,proxyType:1,remoteGlobalIDString:widget,remoteInfo:'BudgetWidget'});
 const dep=add('PBXTargetDependency',{isa:'PBXTargetDependency',target:widget,targetProxy:proxy});o.PBXNativeTarget[app].dependencies.push(ref(dep,'BudgetWidget'));
 const embed=add('PBXBuildFile',{isa:'PBXBuildFile',fileRef:product,settings:{ATTRIBUTES:['RemoveHeadersOnCopy']}});
 const copy=add('PBXCopyFilesBuildPhase',{isa:'PBXCopyFilesBuildPhase',buildActionMask:2147483647,dstPath:'""',dstSubfolderSpec:13,files:[ref(embed,'BudgetWidget.appex in Embed App Extensions')],name:'"Embed App Extensions"',runOnlyForDeploymentPostprocessing:0});o.PBXNativeTarget[app].buildPhases.push(ref(copy,'Embed App Extensions'));
 const addSource=(file,phases)=>{const fr=add('PBXFileReference',{isa:'PBXFileReference',lastKnownFileType:'sourcecode.swift',path:'"'+file+'"',sourceTree:'SOURCE_ROOT'});o.PBXGroup['504EC2FB1FED79650016851F'].children.push(ref(fr,file));for(const phase of phases){const bf=add('PBXBuildFile',{isa:'PBXBuildFile',fileRef:fr});o.PBXSourcesBuildPhase[phase].files.push(ref(bf,file+' in Sources'));}};
 addSource('Shared/WidgetSnapshot.swift',['504EC3001FED79650016851F',sources]);addSource('BudgetWidget/BudgetWidget.swift',[sources]);addSource('BudgetWidget/HomeBudgetWidget.swift',[sources]);addSource('App/BudgetNativePlugin.swift',['504EC3001FED79650016851F']);addSource('App/BudgetViewController.swift',['504EC3001FED79650016851F']);
 const pkg=add('XCRemoteSwiftPackageReference',{isa:'XCRemoteSwiftPackageReference',repositoryURL:'"https://github.com/plaid/plaid-link-ios-spm"',requirement:{kind:'upToNextMajorVersion',minimumVersion:'7.0.0'}});o.PBXProject[root].packageReferences.push(ref(pkg,'Plaid'));
 const link=add('XCSwiftPackageProductDependency',{isa:'XCSwiftPackageProductDependency',package:pkg,productName:'LinkKit'});o.PBXNativeTarget[app].packageProductDependencies.push(ref(link,'LinkKit'));
 const linkBuild=add('PBXBuildFile',{isa:'PBXBuildFile',productRef:link});o.PBXFrameworksBuildPhase['504EC3011FED79650016851F'].files.push(ref(linkBuild,'LinkKit in Frameworks'));
}
for(const config of Object.values(o.XCBuildConfiguration)){if(config.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER==='com.budgetlive.personal'){Object.assign(config.buildSettings,{CODE_SIGN_ENTITLEMENTS:'App/App.entitlements',APP_GROUP_ID:'group.com.budgetlive.personal',MARKETING_VERSION:'0.2.0',IPHONEOS_DEPLOYMENT_TARGET:'16.0'});}}
fs.writeFileSync(path,project.writeSync());
for(const path of ['ios/App/App/SceneDelegate.swift','ios/App/App/Base.lproj/Main.storyboard']){let s=fs.readFileSync(path,'utf8');s=s.replaceAll('CAPBridgeViewController','BudgetViewController');if(path.endsWith('storyboard'))s=s.replace('customModule="Capacitor"','customModule="App"');fs.writeFileSync(path,s);}
console.log('App and Widget targets configured. Xcode compilation/signing still required.');
