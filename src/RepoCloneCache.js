import _ from 'lodash';
import path from 'path';
import fs from 'fs-extra';
import * as git from './git.js';
import * as resolve from './resolve.js';
import * as util from './util.js';

/**
 * @returns {Promise.<string>} - Either 'url', 'target' or empty string, depending what has changed on the repo
 */
async function hasRepoChanged( repo, dir ) {
	const repoUrl = util.parseRepositoryUrl( repo );
	// make sure it's the same repo URL
	const localUrl = await git.getWorkingCopyUrl( dir, true );
	if ( localUrl !== repoUrl.url ) {
		// Repository URL is different to pre-existing module "name"
		return 'url';
	}
	const targetObj = await resolve.getTargetFromRepoUrl( repo );
	const targetCur = await git.getCurrentTarget( dir );
	const targetChanged = targetObj.branch !== targetCur.branch || targetObj.tag !== targetCur.tag;
	if ( targetChanged ) {
		return 'target';
	}
	return '';
}


function getDirs( root ) {
	if ( !fs.existsSync( root ) ) {
		return [];
	}
	const leaves = fs.readdirSync( root );
	let dirs = [];
	for ( const leaf of leaves ) {
		const fullPath = path.join( root, leaf );
		if ( fs.statSync( fullPath ).isDirectory() ) {
			dirs.push( fullPath );
		}
	}
	return dirs;
}

/**
 * When a repo is cloned, it is named a random UUID instead of the final folder name, so it can be checked for conflicts before commiting.
 * This class manages that
 *
 */
class RepoCloneCache {
	constructor( options ) {
		this._options = options;
		this._availableClonedRepos = new Map(); // Map of repo base URL's to checkout folders, which have not been used yet
		this._clones = new Map(); // Map of repo target URLs to checkout folders which have been used
		this._conflicts = new Map(); // name of package vs array of repo directories which are conflicted
	
		this._lockedDirs = new Set(); // packages directories that can not be switched
	}
	
	// /**
	 // * Scans the component directory to find which repos we already have cloned, and adds them to the available repo map
	 // */
	// async init() {
		// const rootPath = await util.getPackageRootPath( this._options.cwd );
		// const dirs = getDirs( rootPath );
		// for ( const dir of dirs ) {
			// if ( fs.existsSync( path.join( dir, '.git' ) ) ) {
				// const localUrl = await git.getWorkingCopyUrl( dir, true );
				// if ( !this._availableClonedRepos.has( localUrl ) ) {
					// this._availableClonedRepos.set( localUrl, [] );
				// }
				// this._availableClonedRepos.get( localUrl ).push( path.basename( dir ) );
			// }
		// }
	// }
	
	// /**
	 // * Checks to see if we already have a cloned repo for this module or clones a fresh one if required
	 // *
	 // * @returns {string} - Directory name inside the package root path of repo
	 // */
	// async _lockRepo( url, module ) {
		// const rootPath = await util.getPackageRootPath( this._options.cwd );
		
		// if ( this._clones.has( module.dir ) && this._clones.get( module.dir ) === module.repo ) {
			// // already checked out this repo & target - use the same one
			// return path.join( rootPath, module.dir );
		// }
		
		// // see if this repo is already cloned and is available to use
		// if ( this._availableClonedRepos.has( url ) ) {
			// const dirsArray = this._availableClonedRepos.get( url );
			// if ( dirsArray.length > 0 ) {
				// let index = dirsArray.indexOf( path.basename( module.dir ) );
				// // look to see if the same directory name is available and prefer to use that one.
				// if ( index < 0 ) {
					// // otherwise use another one
					// index = 0;
				// }
				// const dir = dirsArray.splice( index, 1 )[0];
				// this._clones.set( dir, module.repo );
				// return path.join( rootPath, dir );
			// }
		// }
		// // check out new one if none available
		// const finalModuleDir = path.join( rootPath, module.dir );
		// let checkoutPath;
		// if ( fs.existsSync( finalModuleDir ) ) {
			// checkoutPath = path.join( rootPath, module.id );
			// // conflict detected
			// if ( !this._conflicts.get( module.dir ) ) {
				// this._conflicts.set( module.dir, [finalModuleDir] );
			// }
			// this._conflicts.get( module.dir ).push( checkoutPath );
		// } else {
			// checkoutPath = finalModuleDir;
		// }
		// const targetObj = await resolve.getTargetFromRepoUrl( module.repo );
		// await git.clone( url, checkoutPath, targetObj );
		// this._clones.set( path.basename( checkoutPath ), module.repo );
		// return checkoutPath;
	// }
	
	async _handleConflict( name, module ) {
		
	}
	
	async init() {
		
	}
	
	async add( name, module, options = {} ) {
		const repoUrl = util.parseRepositoryUrl( module.repo );
		const rootPath = await util.getPackageRootPath( this._options.cwd );
		const pkgdir = path.join( rootPath, module.dir );
		if ( !fs.existsSync( pkgdir ) ) {
			// fresh checkout
			const targetObj = await resolve.getTargetFromRepoUrl( module.repo );
			await git.clone( repoUrl.url, pkgdir, targetObj );
		} else {
			const repoState = await hasRepoChanged( module.repo, pkgdir );
			if ( repoState === 'url' ) {
				// dir has already been used by different repo - conflict
				await this._handleConflict( name, module );
			} else if ( repoState === 'target' ) {
				if ( !this._lockedDirs.has( module.dir ) ) {
					// already existing version has not been used already, use that cloned repo to do a switch
					const targetObj = await resolve.getTargetFromRepoUrl( module.repo );
					const stashName = await git.stash( pkgdir );
					await git.pull( pkgdir );
					if ( !options.pullOnly ) {
						await git.checkout( pkgdir, targetObj );
					}
					await git.stashPop( pkgdir, stashName );				
				} else {
					// dir has already been used by a different branch - conflict
					await this._handleConflict( name, module );
				}
			} else {
				// repo is the same - do an update
				const stashName = await git.stash( pkgdir );
				await git.pull( pkgdir );
				await git.stashPop( pkgdir, stashName );				
			}
		}
		if ( !this._lockedDirs.has( module.dir ) ) {
			this._lockedDirs.set( module.dir );
		}
	}
}


export default RepoCloneCache;