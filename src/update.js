import _ from 'lodash';
import path from 'path';
import fs from 'fs';
import * as depTree from './depTree.js';
import * as util from './util.js';
import * as git from './git.js';
import * as resolve from './resolve.js';

async function installMissing( modules ) {
	// download/update modules
	let count = 0;
	for ( const module of modules ) {
		if ( module.status === 'missing' ) {
			console.log( `Installing ${module.name} [${module.repo}]...` );
			const repoUrl = util.parseRepositoryUrl( module.repo );
			const targetObj = await resolve.getTargetFromRepoUrl( module.repo );
			await git.clone( repoUrl.url, module.dir, targetObj );
			console.log( `Complete` );
			count++;
		}
	}
	return count;
}

async function updateProject( dir ) {
	const stashName = await git.stash( dir );
	await git.pull( dir );
	await git.stashPop( dir, stashName );
}


/**
 * Saves the flavio.json to the given directory
 *
 * @param {string} cwd - Working directory
 * @param {Object} json - New flavio.json data object
 * @returns {Promise}
 */
export function saveflavioJson( cwd, json ) {
	const p = path.join( cwd, util.getflavioJsonFileName() );
	return new Promise( (resolv, reject) => {
		fs.writeFile( p, JSON.stringify( json, null, 2 ), 'utf-8', (err) => {
			err ? reject( err ) : resolv();
		} );
	} );
}

async function updateOutofDate( children ) {
	for ( const [name, module] of children ) {
		console.log( `Updating ${name} [${module.repo}]...` );
		// check if the repo path resolves to a different target (ie. it was on a tag 0.1.0, but should now be 0.1.1).
		// If it is, switch over to that. Otherwise, just do a basic pull
		const targetObj = await resolve.getTargetFromRepoUrl( module.repo );
		const targetCur = await git.getCurrentTarget( module.dir );
		const targetChanged = targetObj.branch !== targetCur.branch || targetObj.tag !== targetCur.tag;
		const validTarget = targetObj.branch || targetObj.tag;
		
		const stashName = await git.stash( module.dir );
		if ( targetChanged && validTarget ) {
			console.log( `Switching package ${name} to ${validTarget}` );
			await git.checkout( module.dir, targetObj );
		}
		await git.pull( module.dir );
		await git.stashPop( module.dir, stashName );
		// TODO: detect local change conflicts and report if any
		console.log( `Complete` );
		if ( module.children ) {
			await updateOutofDate( module.children );
		}
	}
}

/**
 * Executes update on given directory
 *
 * @param {Object} options - Command line options
 * @param {string} options.cwd - Working directory
 * @param {boolean} [options.force-latest=false] - Force latest version on conflict
 */
async function update( options ) {
	if ( !_.isString( options.cwd ) ) {
		throw new Error( `Invalid cwd argument ${options.cwd}` );
	}
	// update main project first
	console.log( `Updating main project...` );
	await updateProject( options.cwd );
	console.log( `Complete` );
	await util.readConfigFile( options.cwd );

	// get current tree
	let tree = await depTree.calculate( options );
	
	// pull all modules already cloned
	let modules = await depTree.listChildren( tree );
	for ( const module of modules ) {
		if ( module.status === 'installed' ) {
			console.log( `Updating ${ path.basename( module.dir ) }` );
			await updateProject( module.dir );
		}
	}

	// TODO: resolve any conflicts in dep tree
	
	// keep installing missing modules until no more found
	let missingCount = 0;
	do {
		missingCount = await installMissing( modules );
		tree = await depTree.calculate( options );
		modules = await depTree.listChildren( tree );
	} while ( missingCount > 0 );

//	await updateOutofDate( tree.children );

}

export default update;
