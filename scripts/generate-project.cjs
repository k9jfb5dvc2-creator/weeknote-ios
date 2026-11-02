const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const objects = {};
const id = label => crypto.createHash('sha256').update('WeekNote:' + label).digest('hex').slice(0,24).toUpperCase();
function add(label, value) { const key=id(label);objects[key]=value;return key; }
const products = add('products',{isa:'PBXGroup',children:[],name:'Products',sourceTree:'<group>'});
const product = add('product',{isa:'PBXFileReference',explicitFileType:'wrapper.application',includeInIndex:0,path:'WeekNote.app',sourceTree:'BUILT_PRODUCTS_DIR'});
objects[products].children.push(product);
const swift = ['WeekNoteApp.swift','NativeStore.swift','ReminderService.swift','WebHost.swift'];
const resources = [
 ['Assets.xcassets','folder.assetcatalog'], ['www','folder'], ['PrivacyInfo.xcprivacy','text.xml']
];
const children=[], sourceBuild=[], resourceBuild=[];
for (const name of swift) {
 const file=add('file:'+name,{isa:'PBXFileReference',lastKnownFileType:'sourcecode.swift',path:name,sourceTree:'<group>'});children.push(file);
 sourceBuild.push(add('build:'+name,{isa:'PBXBuildFile',fileRef:file}));
}
for (const [name,type] of resources) {
 const file=add('file:'+name,{isa:'PBXFileReference',lastKnownFileType:type,path:name,sourceTree:'<group>'});children.push(file);
 resourceBuild.push(add('build:'+name,{isa:'PBXBuildFile',fileRef:file}));
}
children.push(add('file:Info.plist',{isa:'PBXFileReference',lastKnownFileType:'text.plist.xml',path:'Info.plist',sourceTree:'<group>'}));
const sourceGroup=add('source-group',{isa:'PBXGroup',children,path:'WeekNote',sourceTree:'<group>'});
const mainGroup=add('main-group',{isa:'PBXGroup',children:[sourceGroup,products],sourceTree:'<group>'});
const sources=add('sources-phase',{isa:'PBXSourcesBuildPhase',buildActionMask:2147483647,files:sourceBuild,runOnlyForDeploymentPostprocessing:0});
const resourcePhase=add('resources-phase',{isa:'PBXResourcesBuildPhase',buildActionMask:2147483647,files:resourceBuild,runOnlyForDeploymentPostprocessing:0});
const frameworks=add('frameworks-phase',{isa:'PBXFrameworksBuildPhase',buildActionMask:2147483647,files:[],runOnlyForDeploymentPostprocessing:0});
function configuration(name,target) {
 const buildSettings=target ? {
  ASSETCATALOG_COMPILER_APPICON_NAME:'AppIcon',CODE_SIGN_STYLE:'Automatic',DEVELOPMENT_TEAM:'',GENERATE_INFOPLIST_FILE:'NO',
  INFOPLIST_FILE:'WeekNote/Info.plist',IPHONEOS_DEPLOYMENT_TARGET:'16.0',LD_RUNPATH_SEARCH_PATHS:['$(inherited)','@executable_path/Frameworks'],
  PRODUCT_BUNDLE_IDENTIFIER:'com.local.weeklystickynote.ios',PRODUCT_NAME:'$(TARGET_NAME)',SDKROOT:'iphoneos',
  SUPPORTED_PLATFORMS:'iphoneos iphonesimulator',SUPPORTS_MACCATALYST:'NO',SWIFT_VERSION:'5.0',TARGETED_DEVICE_FAMILY:'1'
 } : {
  CLANG_ENABLE_MODULES:'YES',CLANG_ENABLE_OBJC_ARC:'YES',CLANG_WARN_DOCUMENTATION_COMMENTS:'YES',GCC_C_LANGUAGE_STANDARD:'gnu17',
  IPHONEOS_DEPLOYMENT_TARGET:'16.0',SDKROOT:'iphoneos',SWIFT_VERSION:'5.0',
  ...(name==='Debug'?{DEBUG_INFORMATION_FORMAT:'dwarf',GCC_PREPROCESSOR_DEFINITIONS:['DEBUG=1','$(inherited)'],SWIFT_OPTIMIZATION_LEVEL:'-Onone',SWIFT_ACTIVE_COMPILATION_CONDITIONS:'DEBUG'}:{DEBUG_INFORMATION_FORMAT:'dwarf-with-dsym',SWIFT_COMPILATION_MODE:'wholemodule',SWIFT_OPTIMIZATION_LEVEL:'-O',VALIDATE_PRODUCT:'YES'})
 };
 return add(`config:${target?'target':'project'}:${name}`,{isa:'XCBuildConfiguration',buildSettings,name});
}
const targetConfigs=add('target-configs',{isa:'XCConfigurationList',buildConfigurations:['Debug','Release'].map(n=>configuration(n,true)),defaultConfigurationIsVisible:0,defaultConfigurationName:'Release'});
const projectConfigs=add('project-configs',{isa:'XCConfigurationList',buildConfigurations:['Debug','Release'].map(n=>configuration(n,false)),defaultConfigurationIsVisible:0,defaultConfigurationName:'Release'});
const target=add('target',{isa:'PBXNativeTarget',buildConfigurationList:targetConfigs,buildPhases:[sources,frameworks,resourcePhase],buildRules:[],dependencies:[],name:'WeekNote',productName:'WeekNote',productReference:product,productType:'com.apple.product-type.application'});
const project=add('project',{isa:'PBXProject',attributes:{BuildIndependentTargetsInParallel:'YES',LastUpgradeCheck:'1600',TargetAttributes:{[target]:{CreatedOnToolsVersion:'16.0'}}},buildConfigurationList:projectConfigs,compatibilityVersion:'Xcode 14.0',developmentRegion:'zh_CN',hasScannedForEncodings:0,knownRegions:['zh_CN','en','Base'],mainGroup,productRefGroup:products,projectDirPath:'',projectRoot:'',targets:[target]});
function encode(value, depth=0) {
 const pad='\t'.repeat(depth);
 if(Array.isArray(value))return `(\n${value.map(x=>`${pad}\t${encode(x,depth+1)},`).join('\n')}\n${pad})`;
 if(value&&typeof value==='object')return `{\n${Object.entries(value).map(([k,v])=>`${pad}\t${JSON.stringify(k)} = ${encode(v,depth+1)};`).join('\n')}\n${pad}}`;
 return typeof value==='number'?String(value):JSON.stringify(String(value));
}
fs.mkdirSync(path.join(root,'WeekNote.xcodeproj/xcshareddata/xcschemes'),{recursive:true});
fs.writeFileSync(path.join(root,'WeekNote.xcodeproj/project.pbxproj'),'// !$*UTF8*$!\n'+encode({archiveVersion:1,classes:{},objectVersion:56,objects,rootObject:project})+'\n');
const reference=`<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${target}" BuildableName="WeekNote.app" BlueprintName="WeekNote" ReferencedContainer="container:WeekNote.xcodeproj"/>`;
fs.writeFileSync(path.join(root,'WeekNote.xcodeproj/xcshareddata/xcschemes/WeekNote.xcscheme'),`<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables/></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>\n`);
console.log('Generated WeekNote.xcodeproj with shared WeekNote scheme.');
