import { CosmosClient } from '@azure/cosmos';
import * as path from 'path';

// Since env.development.json is JSON, dotenv might not parse it. It's better to read and parse it.
import * as fs from 'fs';

async function main() {
    const rawEnv = fs.readFileSync(path.resolve(process.cwd(), 'env.development.json'), 'utf-8');
    const envConfig = JSON.parse(rawEnv);

    console.log('Using endpoint:', envConfig.cosmos_db.endpoint);
    const client = new CosmosClient({
        endpoint: envConfig.cosmos_db.endpoint,
        key: envConfig.cosmos_db.key,
    });
    const database = client.database(envConfig.cosmos_db.database_id);
    const permissionsContainer = database.container('permissions');
    const modelsContainer = database.container('extraction_models');

    const { resources: allGroups } = await permissionsContainer.items
        .query("SELECT * FROM c WHERE c.partition_key = 'group'")
        .fetchAll();

    for (const group of allGroups) {
        if (!group.permissions?.models) continue;
        let updated = false;
        let currentModels = group.permissions.models;
        const newModels = [];

        for (const model of currentModels) {
            try {
                const { resource } = await modelsContainer.item(model.modelId, 'model').read();
                if (resource) {
                    newModels.push(model);
                } else {
                    console.log(`Removed ghost model ${model.modelName} from group ${group.name}`);
                    updated = true;
                }
            } catch (e) {
                console.log(`Removed ghost model ${model.modelName} (Error reading) from group ${group.name}`);
                updated = true;
            }
        }

        if (updated) {
            const updatedGroup = {
                ...group,
                permissions: {
                    ...group.permissions,
                    models: newModels
                },
                updated_at: new Date().toISOString()
            };
            await permissionsContainer.item(group.id, 'group').replace(updatedGroup);
            console.log(`Group ${group.name} updated.`);
        }
    }
    console.log('Cleanup complete.');
}

main().catch(console.error);
