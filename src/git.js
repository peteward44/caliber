import path from 'path';
import _ from 'lodash';
import fs from 'fs-extra';
import uuid from 'uuid';
import { spawn } from 'child_process';


function printError( err, args ) {
	let argsString = args.join( " " );
	console.error( "'git " + argsString + "'" );
	console.error( err );
}


export function executeGit( args, options ) {
	options = options || {};
	return new Promise( ( resolve, reject ) => {
		let stdo = '';
//		console.log( `Executing git ${args.join(" ")}` );
		let proc = spawn( 'git', args, { cwd: options.cwd ? options.cwd : process.cwd(), stdio: ['ignore', options.captureStdout ? 'pipe' : 'inherit', options.outputStderr ? 'inherit' : 'ignore'] } );

		function unpipe() {
		}

		if ( options.captureStdout ) {
			proc.stdout.on( 'data', ( data ) => {
				stdo += data.toString();
			} );
		}
		proc.on( 'error', ( err ) => {
			unpipe();
			if ( options.ignoreError ) {
				resolve( { out: stdo, code: 0 } );
			} else {
				if ( !options.quiet ) {
					printError( err, args );
				}
				reject( err );
			}
		} );
		proc.on( 'exit', ( code ) => {
			unpipe();
		} );
		proc.on( 'close', ( code ) => {
			unpipe();
			if ( code !== 0 && !options.ignoreError ) {
				if ( !options.quiet ) {
					printError( '', args );
				}
				reject( new Error( "Error running git" ) );
			} else {
				resolve( { out: stdo, code: code } );
			}
		} );
	} );
}

function touchFile( filepath, contents ) {
	const dir = path.dirname( filepath );
	fs.ensureDirSync( dir );
	fs.writeFileSync( filepath, contents );
	return Promise.resolve();
}


export async function createRepo( dir, checkoutDir, options = {} ) {
	const alreadyExists = fs.existsSync( dir );
	
	if ( !alreadyExists ) {
		// see http://stackoverflow.com/questions/2337281/how-do-i-do-an-initial-push-to-a-remote-repository-with-git
		fs.ensureDirSync( dir );
		fs.ensureDirSync( checkoutDir );

		// init bare repo
		await executeGit( ['init', '--bare', dir] );
		// init checkout repo
		await executeGit( ['init', checkoutDir] );
	
		// create empty .gitignore file as we need one file to create the HEAD revision
		await touchFile( path.join( checkoutDir, '.gitignore' ), '' );
		
		// do add
		await executeGit( ['add', '.'], { cwd: checkoutDir } );
		// then perform a commit so the HEAD revision exists on master
		await executeGit( ['commit', '-m', 'Creating repo: Initial commit'], { cwd: checkoutDir } );

		// add remote origin
		await executeGit( ['remote', 'add', 'origin', dir], { cwd: checkoutDir } );
		await executeGit( ['push', '-u', 'origin', 'master'], { cwd: checkoutDir } );
	} else {
		console.log( `Already exists ${dir} ${checkoutDir}` );
		fs.ensureDirSync( checkoutDir );
		await executeGit( ['clone', dir, checkoutDir] );
	}
	
	let tempTagBranchName;
	
	if ( options.branch ) {
		// switch to branch before adding files
		await executeGit( ['checkout', '-b', options.branch], { cwd: checkoutDir } );
	} else if ( options.tag ) {
		// if a tag is defined, create temporary branch to put files on
		tempTagBranchName = uuid.v4();
		await executeGit( ['checkout', '-b', tempTagBranchName], { cwd: checkoutDir } );
	}
	
	// add any files
	if ( Array.isArray(options.files) && options.files.length > 0 ) {
		let added = 0;
		for (let i = 0; i < options.files.length; ++i) {
			const file = options.files[i];
			const fullPath = path.join( checkoutDir, file.path );
			if ( !fs.existsSync( fullPath ) ) {
				console.log('Adding file', file.path);
				await touchFile( fullPath, file.contents || '' );
				added++;
			}
		}
		// do add
		if ( added > 0 ) {
			await executeGit( ['add', '.'], { cwd: checkoutDir } );
			await executeGit( ['commit', '-m', 'Creating repo: Adding files'], { cwd: checkoutDir } );
		}
	}
	
	if ( options.tag ) {
		await executeGit( ['tag', '-a', options.tag, '-m', `Creating repo: Creating tag ${options.tag}`], { cwd: checkoutDir } );			
	}
	if ( tempTagBranchName ) {
		// delete local branch for tag
		await executeGit( ['checkout', 'master'], { cwd: checkoutDir } );
		await executeGit( ['branch', '-D', tempTagBranchName], { cwd: checkoutDir } );
	}
	// push
	//await executeGit( [ 'push', '-u', 'origin', name ], { cwd: checkoutDir } );
	await executeGit( ['push', '--all'], { cwd: checkoutDir } );
	if ( options.tag ) {
		await executeGit( ['push', 'origin', options.tag], { cwd: checkoutDir } );
	}
}


export async function addProject( tempDir, project, rootObj = null, repoMap = new Map() ) {
	project.name = project.name || 'default';
	if ( !repoMap.has( project.name ) ) {
		repoMap.set( project.name, uuid.v4() );
	}
	const repoId = repoMap.get( project.name );
	const repoDir = path.resolve( path.join( tempDir, repoId ) );
	const checkoutDir = path.resolve( path.join( tempDir, uuid.v4() ) );

	// create new flavio.json based on deps
	const flavioJson = {
		name: project.name,
		version: project.version || '0.0.1-snapshot.0',
		dependencies: {}
	};
	
	let result = {
		repoDir,
		checkoutDir,
		deps: {},
		alldeps: {}
	};
	if ( !rootObj ) {
		rootObj = result;
	}
	
	// add given modules
	if (Array.isArray(project.modules)) {
		for (let i = 0; i < project.modules.length; ++i) {
			const mod = project.modules[i];
			// create repo for the module
			const moduleResult = await addProject( tempDir, mod, rootObj, repoMap );
			if (!mod.dontAddToParent) {
				let target = 'master';
				if ( mod.tag ) {
					target = mod.tag;
				} else if ( mod.branch ) {
					target = mod.branch;
				}
				flavioJson.dependencies[mod.name] = `${moduleResult.repoDir}#${target}`;
			}
			result.deps[mod.name] = moduleResult;
			rootObj.alldeps[mod.name] = moduleResult; // add dependency to root result object for easy access of dependencies-of-dependencies in unit tests
		}
	}

	// add flavio.json
	const files = Array.isArray( project.files ) ? project.files.slice(0) : [];
	if (!project.noflaviojson) {
		files.push( { path: 'flavio.json', contents: JSON.stringify( flavioJson, null, '\t' ) } );
	}

	await createRepo( repoDir, checkoutDir, { files, branch: project.branch, tag: project.tag } );
	console.log(`Created repo ${repoDir}`);

	return result;
}


export async function getCurrentTarget( dir ) {
	// from http://stackoverflow.com/questions/18659425/get-git-current-branch-tag-name
	// check for branch name
	try {
		let result = ( await executeGit( ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: dir, ignoreError: true, captureStdout: true } ) );
		let name = result.out.trim();
		if ( result.code === 0 && name.length > 0 ) {
			return { branch: name };
		}
	} catch ( e ) {}

	// then check if it's pointing at a tag
	try {
		const tagResult = await executeGit( ['describe', '--tags', '--exact-match'], { cwd: dir, ignoreError: true, captureStdout: true } );
		const tag = tagResult.out.trim();
		if ( tagResult.code === 0 && tag.length > 0 ) {
			return { tag };
		}
	} catch ( e ) {}

	// then the repo is probably in detached head state pointing a particular commit
	try {
		const commitResult = await executeGit( ['rev-parse', '--verify', 'HEAD'], { cwd: dir, ignoreError: true, captureStdout: true } );
		const commit = commitResult.out.trim();
		if ( commitResult.code === 0 && commit.length > 0 ) {
			return { commit };
		}
	} catch ( e ) {}
	
	throw new Error( `git.getCurrentTarget() - Could not determine target for repo ${dir}` );
}


/** Gets information on a working copy
 *
 * @param {string} dir - Working copy directory
 * @param {boolean} [bare=false] - If true, just return URL without target on end
 * @returns {string} Repo url
 */
export async function getWorkingCopyUrl( dir, bare = false ) {
	// git is a bit more complicated than svn as a repo can have multiple remotes.
	// always assume 'origin' - TODO: allow an option to change this behaviour
	const result = await executeGit( ['config', '--get', 'remote.origin.url'], { cwd: dir, captureStdout: true } );
	const url = result.out.trim();
	const target = await getCurrentTarget( dir );
	return bare ? url : `${url}#${target.branch || target.tag || target.commit}`;
}


export async function clone( url, dir, options = {} ) {
	dir = path.resolve( dir );
	fs.ensureDirSync( dir );
	await executeGit( ['clone', url, dir, ...( options.minimal ? ['--no-checkout', '--depth=1'] : [] )] );
	if ( options.tag ) {
		await executeGit( ['checkout', `tags/${options.tag}`], { cwd: dir } );
	} else if ( options.branch || options.commit ) {
		await executeGit( ['checkout', options.branch || options.commit], { cwd: dir } );
	}
}


/** Lists all the tags that are part of the repository
 * @param {string} url URL
 */
export async function listTags( localClonePath ) {
	let result = [];
	let out = ( await executeGit( ['tag'], { cwd: localClonePath, captureStdout: true } ) ).out.trim();
	let array = out.split( '\n' );
	for ( let i=0; i<array.length; ++i ) {
		let t = array[i].trim();
		if ( t.length > 0 ) {
			result.push( t );
		}
	}
	return result;
}

/** Lists all the tags that are part of the repository
 * @param {string} url URL
 */
// export async function listBranches( localClonePath ) {
	// let result = [];
	// let out = ( await executeGit( ['branch'], { cwd: localClonePath, captureStdout: true } ) ).out.trim();
	// let array = out.split( '\n' );
	// for ( let i=0; i<array.length; ++i ) {
		// let t = array[i].trim();
		// if ( t.length > 0 ) {
			// result.push( t );
		// }
	// }
	// return result;
// }

/** Checks if a working copy is clean
 * @param {string} dir Working copy
 * @param {string|Array} [filename] Optional specific filename to check
 */
export async function isWorkingCopyClean( dir, filename ) {
	let args = ['diff', 'HEAD'];
	if ( filename ) {
		args.push( '--' );
		if ( Array.isArray( filename ) ) {
			args = args.concat( filename );
		} else {
			args.push( filename );
		}
	}
	let out = ( await executeGit( args, { cwd: dir, captureStdout: true } ) ).out;
	out.trim();
	return out.length === 0;
}


export async function stash( dir ) {
	let clean = await isWorkingCopyClean( dir );
	const stashName = uuid.v4();
	if ( !clean ) {
		await executeGit( ['stash', 'save', stashName, '-u'], { cwd: dir } );
		// check if it got saved
		const listOut = ( await executeGit( ['stash', 'list'], { cwd: dir, captureStdout: true } ) ).out;
		if ( !listOut.match( stashName ) ) {
			clean = true;
		}
	}
	return clean ? null : stashName;
}


export async function stashPop( dir, stashName ) {
	if ( stashName ) {
		try {
			await executeGit( ['stash', 'pop'], { cwd: dir } );
		} catch ( err ) {
		}
	}
}


export async function pull( dir ) {
	const target = await getCurrentTarget( dir );
	if ( target.branch ) {
		await executeGit( ['pull'], { cwd: dir, outputStderr: true } );
	}
}

export async function checkout( dir, target, ...files ) {
	if ( target.branch || target.commit ) {
		await executeGit( ['checkout', target.branch || target.commit, ...files], { cwd: dir } );
	} else if ( target.tag ) {
		await executeGit( ['checkout', `tags/${target.tag}`, ...files], { cwd: dir } );
	}
}

export async function getLastCommit( dir ) {
	const out = ( await executeGit( ['log', '-n', '1', '--pretty=format:%H'], { cwd: dir, captureStdout: true } ) ).out;
	return out.trim();
}

export async function tagExists( dir, tag ) {
	const list = await listTags( dir );
	return _.indexOf( list, tag ) >= 0;
}

export async function createAndCheckoutBranch( dir, branch ) {
	await executeGit( ['checkout', '-b', branch], { cwd: dir } );
}

export async function createBranch( dir, branch ) {
	await executeGit( ['branch', branch], { cwd: dir } );
}

export async function addAndCommit( dir, filename, commitMessage ) {
	if ( !Array.isArray( filename ) ) {
		filename = [filename];
	}
	await executeGit( ['add', ...filename], { cwd: dir } );
	await executeGit( ['commit', '-m', commitMessage, ...filename], { cwd: dir } );
}

export async function createTag( dir, tagName, message ) {
	await executeGit( ['tag', '-a', tagName, '-m', message], { cwd: dir } );
}

export async function push( dir, args = [] ) {
	await executeGit( ['push', ...args], { cwd: dir } );
}

export async function fetch( dir, args = [] ) {
	await executeGit( ['fetch', ...args], { cwd: dir } );
}

export async function isUpToDate( dir ) {
	try {
		await executeGit( ['fetch'], { cwd: dir, quiet: true, outputStderr: true } );
		const local = ( await executeGit( ['rev-parse', 'HEAD'], { cwd: dir, quiet: true, captureStdout: true } ) ).out;
		const remote = ( await executeGit( ['rev-parse', '@{u}'], { cwd: dir, quiet: true, captureStdout: true } ) ).out;
		return local.trim() === remote.trim();
	} catch ( err ) {}
	return true;
}

export async function listFiles( dir ) {
	const raw = ( await executeGit( ['ls-files'], { cwd: dir, captureStdout: true } ) ).out;
	return raw.trim().split( '\n' ).map( file => file.trim() );
}

export async function doesLocalBranchExist( dir, branchName ) {
	const code = ( await executeGit( ['rev-parse', '--verify', branchName], { cwd: dir, ignoreError: true } ) ).code;
	return code === 0;
}

export async function doesRemoteBranchExist( url, branchName ) {
	const code = ( await executeGit( ['ls-remote', '--exit-code', url, branchName], { ignoreError: true } ) ).code;
	return code === 0;
}

export async function deleteRemoteBranch( dir, branchName ) {
	await executeGit( ['fetch'], { cwd: dir, outputStderr: true } );
	await executeGit( ['push', 'origin', '--delete', branchName], { cwd: dir } );
}

export async function show( dir, branch, file ) {
	const output = ( await executeGit( ['show', `${branch}:${file}`], { cwd: dir, quiet: true, captureStdout: true } ) ).out;
	return output;
}

export async function isValidCommit( dir, sha ) {
	const result = await executeGit( ['branch', '-r', '--contains', sha], { cwd: dir, ignoreError: true } );
	return result.code === 0;
}

export async function isConflicted( dir ) {
	const output = ( await executeGit( ['ls-files', '--unmerged'], { cwd: dir, captureStdout: true } ) ).out;
	return output.trim().length > 0;
}
