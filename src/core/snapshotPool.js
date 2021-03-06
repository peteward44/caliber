import GitRepositorySnapshot from './GitRepositorySnapshot.js';
import globalConfig from './globalConfig.js';

class SnapshotPool {
	constructor() {
		this._cache = new Map();

		globalConfig.onInit = () => {
			this.clearAll();
		};
	}

	async fromName( name, ref ) {
		const id = `${name}_${ref}`;
		if ( !this._cache.has( id ) ) {
			const snapshot = await GitRepositorySnapshot.fromName( name, ref );
			this._cache.set( id, snapshot );
		}
		return this._cache.get( id );
	}

	async clear( name ) {
		if ( this._cache.has( name ) ) {
			this._cache.delete( name );
		}
	}
	
	clearAll() {
		this._cache.clear();
	}
}

export default new SnapshotPool();
