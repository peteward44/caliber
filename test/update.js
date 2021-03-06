import fs from 'fs-extra';
import path from 'path';
import chai from 'chai';
import { execSync } from 'child_process';
import * as helpers from '../testutil/helpers.js';
import * as git from '../src/core/git.js';
import * as util from '../src/core/util.js';
import update from '../src/commands/update.js';
import status from '../src/commands/status.js';
import TestRepo from '../testutil/TestRepo.js';

async function addFileToRepo( tempDir, repoDir, file, contents ) {
	const tmpCheckoutDir = path.join( tempDir, `${Math.floor( Math.random() * 1000000 )}` );
	execSync( `git clone ${repoDir} ${path.basename( tmpCheckoutDir )}`, { stdio: 'inherit', cwd: path.dirname( tmpCheckoutDir ) } );
	fs.ensureDirSync( path.dirname( path.join( tmpCheckoutDir, file ) ) );
	fs.writeFileSync( path.join( tmpCheckoutDir, file ), contents, 'utf8' );
	execSync( `git add --all`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git commit -am "Added new file"`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git push -f origin master`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	fs.removeSync( tmpCheckoutDir );
}

async function createTag( tempDir, repoDir, tagName, flavioDependencies ) {
	const tmpCheckoutDir = path.join( tempDir, `${Math.floor( Math.random() * 1000000 )}` );
	execSync( `git clone ${repoDir} ${path.basename( tmpCheckoutDir )}`, { stdio: 'inherit', cwd: path.dirname( tmpCheckoutDir ) } );
	execSync( `git checkout -b test_tag_branch`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	fs.writeFileSync( path.join( tmpCheckoutDir, `${tagName}.txt` ), 'file contents', 'utf8' );
	if ( flavioDependencies ) {
		const json = JSON.parse( fs.readFileSync( path.join( tmpCheckoutDir, 'flavio.json' ), 'utf8' ) );
		json.dependencies = json.dependencies || {};
		for ( const [name, val] of Object.entries( flavioDependencies ) ) {
			json.dependencies[name] = val;
		}
		fs.writeFileSync( path.join( tmpCheckoutDir, 'flavio.json' ), JSON.stringify( json, null, 2 ), 'utf8' );
	}
	execSync( `git add --all`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git commit -am "Added new file"`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git push -u origin test_tag_branch`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git tag -a ${tagName} -m "created ${tagName}"`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git checkout master`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	//execSync( `git branch -D test_tag_branch`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	execSync( `git push origin ${tagName}`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	//execSync( `git push --all`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
	fs.removeSync( tmpCheckoutDir );
}

describe(`update tests`, function() {
	this.timeout(30 * 60 * 1000); // 30 minutes

	helpers.test('no dependencies', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'none' );
		await update( { cwd: result.project.checkoutDir } );
		await result.assertDependencyExists( 'main' );
	});

	helpers.test('one dependency', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'one' );
		await result.assertDependencyNotExists( 'dep1' );
		await update( { cwd: result.project.checkoutDir } );
		await result.assertDependencyExists( 'dep1' );
	});

	helpers.test('more complicated tree', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'simpleNest' );
		await update( { cwd: result.project.checkoutDir } );
		await result.assertDependencyExists( 'dep1' );
		await result.assertDependencyExists( 'dep2' );
		await result.assertDependencyExists( 'dep2-1' );
	});

	helpers.test('more complicated tree, making sure changes in dependencies-of-dependencies are updated', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'simpleNest' );
		await update( { cwd: result.project.checkoutDir } );
		await result.assertDependencyExists( 'dep1' );
		await result.assertDependencyExists( 'dep2' );
		await result.assertDependencyExists( 'dep2-1' );
		
		const rootDependenciesDir = path.join( result.project.checkoutDir, 'flavio_modules' );
		
		await addFileToRepo( tempDir, result.project.deps.dep1.repoDir, 'file_added1.txt', 'file contents' );
		await update( { cwd: result.project.checkoutDir } );
		chai.assert.ok( fs.existsSync( path.join( rootDependenciesDir, 'dep1', 'file_added1.txt' ) ), 'Immediate dependency dep1 updates correctly' );

		await addFileToRepo( tempDir, result.project.deps.dep2.repoDir, 'file_added2.txt', 'file contents' );
		await update( { cwd: result.project.checkoutDir } );
		chai.assert.ok( fs.existsSync( path.join( rootDependenciesDir, 'dep2', 'file_added2.txt' ) ), 'Immediate dependency dep2 updates correctly' );
		
		await addFileToRepo( tempDir, result.project.alldeps["dep2-1"].repoDir, 'file_added2-1.txt', 'file contents' );
		await update( { cwd: result.project.checkoutDir } );
		chai.assert.ok( fs.existsSync( path.join( rootDependenciesDir, 'dep2-1', 'file_added2-1.txt' ) ), 'Dependency-of-dependency updates correctly' );
	});

	helpers.test('complicated tree should not be checked out with ignore-dependencies flag', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'simpleNest' );
		await update( { 'cwd': result.project.checkoutDir, 'ignore-dependencies': true } );
		await result.assertDependencyNotExists( 'dep1' );
		await result.assertDependencyNotExists( 'dep2' );
		await result.assertDependencyNotExists( 'dep2-1' );
	});

	// TODO: not working ?
	helpers.test.skip('conflict between same repo with different versions resolved automatically', async (tempDir) => {
		// add another dependency called 'dep2-1' with a higher version number
		const result = await TestRepo.create( tempDir, 'simpleNest', {
			modules: [
				{},
				{},
				{
					name: 'dep2-1',
					version: '0.2.0-snapshot.0',
					files: [
						{
							path: 'file.txt',
							contents: 'newer contents'
						}
					]
				}
			]
		} );
		await update( { cwd: result.project.checkoutDir, interactive: false } );
		await result.assertDependencyExists( 'dep1' );
		await result.assertDependencyExists( 'dep2' );
		await result.assertDependencyExists( 'dep2-1' );
		chai.assert.ok( fs.existsSync( path.join( result.project.checkoutDir, 'flavio_modules', 'dep2-1', 'file.txt' ) ), 'file.txt exists on hdd' );
		chai.assert.equal( fs.readFileSync( path.join( result.project.checkoutDir, 'flavio_modules', 'dep2-1', 'file.txt' ), 'utf8' ), 'newer contents', 'file.txt is newer version' );
	});

	helpers.test('conflict between same repo with different versions resolved automatically when force-latest is true, and is switched correctly when version is changed', async (tempDir) => {
		// const result = await TestRepo.create( tempDir, 'simpleNest', {
			// modules: [
				// {},
				// {},
				// {
					// name: 'dep2-1',
					// version: '0.2.0-snapshot.0',
					// files: [
						// {
							// path: 'file.txt',
							// contents: 'newer contents'
						// }
					// ]
				// }
			// ]
		// } );
		// // do force-latest to make sure we get v0.2.0 of dep2-1
		// await update( { 'cwd': result.project.checkoutDir, 'force-latest': true } );
		// await result.assertDependencyExists( 'dep1' );
		// await result.assertDependencyExists( 'dep2' );
		// await result.assertDependencyExists( 'dep2-1' );
		// // now change main2 reference in root flavio.json to 0.2.0, and see if that works
		// const rootFlavioJson = JSON.parse( fs.readFileSync( path.join( result.project.checkoutDir, 'flavio.json' ), 'utf8' ) );
		// const main2url = util.parseRepositoryUrl( rootFlavioJson.dependencies['dep2-1'] );
		// rootFlavioJson.dependencies['dep2-1'] = `${main2url.url}#0.1.0-snapshot.0`;
		// fs.writeFileSync( path.join( result.project.checkoutDir, 'flavio.json' ), JSON.stringify( rootFlavioJson, null, 2 ), 'utf8' );

		// await update( { 'cwd': result.project.checkoutDir, 'force-latest': true, 'switch': true } );
		// await result.assertDependencyTarget( 'dep2-1', { branch: '' } );

		// chai.assert.ok( !fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.1.1.0.txt' ) ), 'main2 is not 1.1.0' );
		// chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.0.2.0.txt' ) ), 'main2 is 0.2.0' );
		// chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main3', 'file3.txt' ) ), 'main3 dependency installed' );

		const result = await helpers.addProject( tempDir, {
			name: 'main',
			version: '0.1.0-snapshot.0',
			files: [
				{
					path: 'file.txt',
					contents: 'this is on the main project'
				}
			],
			modules: [
				{
					name: 'main2',
					version: '1.1.0',
					tag: '1.1.0',
					files: [
						{
							path: 'file2.1.1.0.txt',
							contents: 'this is on the main2 project v0.1.0'
						}
					]
				},
				{
					name: 'main3',
					version: '0.2.0',
					files: [
						{
							path: 'file3.txt',
							contents: 'this is on the main2 project v0.2.0'
						}
					],
					modules: [
						{
							name: 'main2',
							version: '0.2.0',
							tag: '0.2.0',
							files: [
								{
									path: 'file2.0.2.0.txt',
									contents: 'this is on the main2 project v0.2.0'
								}
							]
						}
					]
				}
			]
		} );
		// do force-latest to make sure we get v1.1.0 of main2
		await update( { 'cwd': result.checkoutDir, 'force-latest': true } );
		console.log( `checkoutDir = ${path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.1.1.0.txt' )}` );
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.1.1.0.txt' ) ), 'main2 dependency installed' );
		chai.assert.ok( !fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.0.2.0.txt' ) ), 'main2 dependency installed' );
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main3', 'file3.txt' ) ), 'main3 dependency installed' );

		// now change main2 reference in root flavio.json to 0.2.0, and see if that works
		const rootFlavioJson = JSON.parse( fs.readFileSync( path.join( result.checkoutDir, 'flavio.json' ), 'utf8' ) );
		const main2url = util.parseRepositoryUrl( rootFlavioJson.dependencies.main2 );
		rootFlavioJson.dependencies.main2 = `${main2url.url}#0.2.0`;
		fs.writeFileSync( path.join( result.checkoutDir, 'flavio.json' ), JSON.stringify( rootFlavioJson, null, 2 ), 'utf8' );

		await update( { 'cwd': result.checkoutDir, 'force-latest': true, 'switch': true } );

		chai.assert.ok( !fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.1.1.0.txt' ) ), 'main2 is not 1.1.0' );
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.0.2.0.txt' ) ), 'main2 is 0.2.0' );
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main3', 'file3.txt' ) ), 'main3 dependency installed' );
	});

	helpers.test('remote-reset flag resets the branch on a module which has a missing upstream branch', async (tempDir) => {
		const result = await helpers.addProject( tempDir, {
			name: 'main',
			version: '0.1.0-snapshot.0',
			files: [
				{
					path: 'file.txt',
					contents: 'this is on the main project'
				}
			],
			modules: [
				{
					name: 'main2',
					version: '0.2.0-snapshot.0',
					branch: 'my_branch',
					files: [
						{
							path: 'file2.txt',
							contents: 'this is on the main2 project v0.1.0'
						}
					]
				}
			]
		} );
		// set up first
		await update( { 'cwd': result.checkoutDir } );

		chai.assert.equal( ( await git.getCurrentTarget( path.join( result.checkoutDir, 'flavio_modules', 'main2' ) ) ).branch, 'my_branch', 'main2 dependency is on branch "my_branch"' );

		await git.deleteRemoteBranch( path.join( result.checkoutDir, 'flavio_modules', 'main2' ), 'my_branch' );

		// then this should perform branch reset on main2 to master
		await update( { 'cwd': result.checkoutDir, 'remote-reset': true } );

		chai.assert.equal( ( await git.getCurrentTarget( path.join( result.checkoutDir, 'flavio_modules', 'main2' ) ) ).branch, 'master', 'main2 dependency installed' );
	});

	helpers.test('remote-reset flag resets the branch on a module which has a missing upstream branch, with outstanding merge conflict', async (tempDir) => {
		const result = await helpers.addProject( tempDir, {
			name: 'main',
			version: '0.1.0-snapshot.0',
			files: [
				{
					path: 'file.txt',
					contents: 'this is on the main project'
				}
			],
			modules: [
				{
					name: 'main2',
					version: '0.2.0-snapshot.0',
					files: [
						{
							path: 'file2.txt',
							contents: 'this is on the main2 project v0.1.0'
						}
					]
				}
			]
		} );
		addFileToRepo( tempDir, result.deps.main2.repoDir, "file3.txt", 'original\n\nsfwefwefwef\n\nasssssssssssssssss\n\n' );
		
		// set up first
		await update( { 'cwd': result.checkoutDir } );
		
		// add a new branch, switch to it manually, delete it, add some conflicting changes, then update
		execSync( `git checkout -b my_branch`, { cwd: path.join( result.checkoutDir, 'flavio_modules', 'main2' ), stdio: 'inherit' } );

	//	await git.deleteRemoteBranch( path.join( result.checkoutDir, 'flavio_modules', 'main2' ), 'my_branch' );

		// make a local change to dependency master with missing branch
		addFileToRepo( tempDir, result.deps.main2.repoDir, "file3.txt", 'sausages\n\nfile contents\n\npineapples\n\n' );
		
		fs.writeFileSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file3.txt' ), 'sausages\n\nfiewl cwontents\n\npineapples\n\n', 'utf8' );
		execSync( `git add --all`, { cwd: path.join( result.checkoutDir, 'flavio_modules', 'main2' ), stdio: 'inherit' } );

		// then this should perform branch reset on main2 to master
		await update( { 'cwd': result.checkoutDir, 'remote-reset': true } );

		chai.assert.equal( ( await git.getCurrentTarget( path.join( result.checkoutDir, 'flavio_modules', 'main2' ) ) ).branch, 'master', 'main3 dependency installed' );
	});

	helpers.test('one dependency on a branch', async (tempDir) => {
		const result = await helpers.addProject( tempDir, {
			name: 'main',
			version: '0.1.0-snapshot.0',
			files: [
				{
					path: 'file.txt',
					contents: 'this is on the main project'
				}
			],
			modules: [
				{
					name: 'main2',
					branch: 'branchname',
					version: '0.2.0-snapshot.0',
					files: [
						{
							path: 'file2.txt',
							contents: 'this is on the main2 project'
						}
					]
				}
			]
		} );
		await update( { cwd: result.checkoutDir } );
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file2.txt' ) ), 'main2 dependency installed' );
	});

	helpers.test('Root repository gets updated', async (tempDir) => {
		const result = await helpers.addProject( tempDir, {
			name: 'main',
			version: '0.1.0-snapshot.0',
			files: [
				{
					path: 'file.txt',
					contents: 'this is on the main project'
				}
			],
			modules: [
				{
					name: 'main2',
					branch: 'branchname',
					version: '0.2.0-snapshot.0',
					files: [
						{
							path: 'file2.txt',
							contents: 'this is on the main2 project'
						}
					]
				}
			]
		} );
		
		await addFileToRepo( tempDir, result.repoDir, 'file_added1.txt', 'file contents' );
		await update( { cwd: result.checkoutDir } );
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'file_added1.txt' ) ), 'Main repository updated' );
	});

	helpers.test.skip('one dependency on a specific commit', async (tempDir) => {

	});

	helpers.test.skip('update should be aborted if conflicts are detected', async (tempDir) => {

	});

	helpers.test.skip('update shouldn\'t break if an empty folder with a dependency name is left in the flavio_modules folder', async (tempDir) => {

	});

	helpers.test('if a dependency has been recreated (ie assets wipe), old repo should be deleted and recreated', async (tempDir) => {
		const result = await helpers.addProject( tempDir, {
			name: 'main',
			version: '0.1.0-snapshot.0',
			files: [
				{
					path: 'file.txt',
					contents: 'this is on the main project'
				}
			],
			modules: [
				{
					name: 'main2',
					version: '0.2.0-snapshot.0',
					files: [
						{
							path: 'file2.txt',
							contents: 'this is on the main2 project'
						}
					]
				}
			]
		} );
		
		await update( { cwd: result.checkoutDir } );
		
		// recreate main2 repo
		const tmpCheckoutDir = path.join( tempDir, "__recreate__" );
		execSync( `git clone ${result.deps.main2.repoDir} ${path.basename( tmpCheckoutDir )}`, { stdio: 'inherit', cwd: path.dirname( tmpCheckoutDir ) } );
		fs.removeSync( path.join( tmpCheckoutDir, '.git' ) );
		execSync( `git init`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
		execSync( `git remote add origin ${result.deps.main2.repoDir}`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
		fs.writeFileSync( path.join( tmpCheckoutDir, 'file3.txt' ), 'file contents', 'utf8' );
		execSync( `git add --all`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
		execSync( `git commit -am "Git history wiped to reduce repo size"`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
		execSync( `git push -f origin master`, { cwd: tmpCheckoutDir, stdio: 'inherit' } );
		
		await update( { cwd: result.checkoutDir } );
		
		chai.assert.ok( fs.existsSync( path.join( result.checkoutDir, 'flavio_modules', 'main2', 'file3.txt' ) ), 'Repo recreated and updated successfully' );
	});
	
	helpers.test( 'Clone a plain repository with dependencies and nested dependencies. Move one of the dependencies to a tag and make sure it changes on update --switch', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'none', {
			name: 'main',
			version: '0.1.0-snapshot.0',
			modules: [
				{
					name: 'main2',
					version: '0.2.0',
					modules: [
						{
							name: 'main3',
							version: '0.3.0',
							modules: [
								{
									name: 'main4',
									version: '0.4.0'
								}
							]
						}
					]
				}
			]
		} );
		
		await update( { cwd: result.project.checkoutDir, interactive: false } );
		
		await createTag( tempDir, result.project.alldeps.main4.repoDir, '1.0.0' );
		await createTag( tempDir, result.project.alldeps.main3.repoDir, '1.0.0', { "main4": `${result.project.alldeps.main4.repoDir}#1.0.0` } );
		await createTag( tempDir, result.project.alldeps.main2.repoDir, '1.0.0', { "main3": `${result.project.alldeps.main3.repoDir}#1.0.0` } );
		
		const f = JSON.parse( fs.readFileSync( path.join( result.project.checkoutDir, 'flavio.json' ), 'utf8' ) );
		f.dependencies.main2 = `${result.project.alldeps.main2.repoDir}#1.0.0`;
		fs.writeFileSync( path.join( result.project.checkoutDir, 'flavio.json' ), JSON.stringify( f, null, 2 ), 'utf8' );

		await update( { cwd: result.project.checkoutDir, interactive: false, switch: true } );
		await status( { cwd: result.project.checkoutDir, interactive: false } );
		
		await result.assertDependencyTarget( 'main2', { tag: '1.0.0' } );
		await result.assertDependencyTarget( 'main3', { tag: '1.0.0' } );
		await result.assertDependencyTarget( 'main4', { tag: '1.0.0' } );
	});
	
	helpers.test( 'Clone a plain repository with dependencies and nested dependencies. Move one of the dependencies-of-a-dependency to a tag and make sure it changes on update --switch', async (tempDir) => {
		const result = await TestRepo.create( tempDir, 'none', {
			name: 'main',
			version: '0.1.0-snapshot.0',
			modules: [
				{
					name: 'main2',
					version: '0.2.0',
					modules: [
						{
							name: 'main3',
							version: '0.3.0',
							modules: [
								{
									name: 'main4',
									version: '0.4.0'
								}
							]
						}
					]
				}
			]
		} );
		
		await update( { cwd: result.project.checkoutDir, interactive: false } );
		
		await createTag( tempDir, result.project.alldeps.main4.repoDir, '1.0.0' );
		await createTag( tempDir, result.project.alldeps.main3.repoDir, '1.0.0', { "main4": `${result.project.alldeps.main4.repoDir}#1.0.0` } );
		
		const f = JSON.parse( fs.readFileSync( path.join( result.project.alldeps.main2.checkoutDir, 'flavio.json' ), 'utf8' ) );
		f.dependencies.main3 = `${result.project.alldeps.main3.repoDir}#1.0.0`;
		fs.writeFileSync( path.join( result.project.alldeps.main2.checkoutDir, 'flavio.json' ), JSON.stringify( f, null, 2 ), 'utf8' );
		execSync( `git add flavio.json`, { cwd: result.project.alldeps.main2.checkoutDir, stdio: 'inherit' } );
		execSync( `git commit -m "added file"`, { cwd: result.project.alldeps.main2.checkoutDir, stdio: 'inherit' } );
		execSync( `git push -f origin master`, { cwd: result.project.alldeps.main2.checkoutDir, stdio: 'inherit' } );

		await update( { cwd: result.project.checkoutDir, interactive: false, switch: true } );
		await status( { cwd: result.project.checkoutDir, interactive: false } );
		
		await result.assertDependencyTarget( 'main2', { branch: 'master' } );
		await result.assertDependencyTarget( 'main3', { tag: '1.0.0' } );
		await result.assertDependencyTarget( 'main4', { tag: '1.0.0' } );
	});
});
