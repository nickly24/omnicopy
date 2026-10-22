import io
import re
import time
import unittest

from main import app, _rooms, Room, MAX_FILE_SIZE, MAX_TEXT_LENGTH


class PluginAPITest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        _rooms.clear()
        self.client = app.test_client()
        self.room = self.client.post('/api/v1/rooms', json={'title': 'Из чата', 'content': 'Привет'}).json
        self.root = '/api/v1/rooms/' + self.room['id']

    def test_complete_plugin_workflow_visible_in_web(self):
        self.assertEqual(self.room['buffers'][0]['content'], 'Привет')
        created = self.client.post(self.root + '/buffers', json={'title': 'SQL', 'content': 'SELECT 1;'})
        self.assertEqual(created.status_code, 201)
        note = created.json
        path = self.root + '/buffers/' + note['id']
        self.assertEqual(self.client.get(path).json['content'], 'SELECT 1;')
        self.assertEqual(len(self.client.get(self.root + '/buffers').json['buffers']), 2)
        saved = self.client.patch(path, json={'content': 'SELECT 2;'})
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json['version'], 2)
        web = self.client.get('/api/rooms/' + self.room['id']).json
        self.assertEqual(web['notes'][1]['content'], 'SELECT 2;')
        upload = self.client.post(path + '/files', data={'file': (io.BytesIO(b'\x00hello\xff'), 'пример.bin')})
        self.assertEqual(upload.status_code, 201)
        f = upload.json['file']
        self.assertEqual(f['buffer_id'], note['id'])
        self.assertEqual(f['name'], 'пример.bin')
        self.assertEqual(self.client.get(f['download_url']).data, b'\x00hello\xff')
        self.assertEqual(len(self.client.get(path + '/files').json['files']), 1)
        self.assertEqual(len(self.client.get(self.root + '/files').json['files']), 1)
        self.assertEqual(self.client.delete(f['download_url']).status_code, 200)
        self.assertEqual(self.client.get(path + '/files').json['files'], [])
        self.assertEqual(self.client.delete(path).status_code, 200)
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.delete(self.root).json['deleted'], True)
        self.assertEqual(self.client.get(self.root).status_code, 404)

    def test_versions_are_optional_but_conflicts_preserve_text(self):
        note = self.room['buffers'][0]
        path = self.root + '/buffers/' + note['id']
        self.assertEqual(self.client.patch(path, json={'title': 'Новое название'}).status_code, 200)
        conflict = self.client.patch(path, json={'version': 1, 'content': 'stale'})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json['note']['content'], 'Привет')
        self.assertEqual(self.client.patch(path, json={'version': 2, 'content': ''}).status_code, 200)
        self.assertEqual(self.client.get(path).json['content'], '')

    def test_room_isolation_for_buffers_and_files(self):
        another = self.client.post('/api/v1/rooms').json
        other_root = '/api/v1/rooms/' + another['id']
        note = self.room['buffers'][0]
        path = self.root + '/buffers/' + note['id']
        file = self.client.post(path + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt')}).json['file']
        for method in ['get', 'patch', 'delete']:
            options = {'json': {'content': 'bad'}} if method == 'patch' else {}
            self.assertEqual(getattr(self.client, method)(other_root + '/buffers/' + note['id'], **options).status_code, 404)
        for method in ['get', 'delete']:
            self.assertEqual(getattr(self.client, method)(other_root + '/files/' + file['id']).status_code, 404)
        self.assertEqual(self.client.post(other_root + '/buffers/' + note['id'] + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt')}).status_code, 404)
        self.assertEqual(self.client.get(path).json['content'], 'Привет')

    def test_delete_primary_and_final_buffer(self):
        note = self.room['buffers'][0]
        path = self.root + '/buffers/' + note['id']
        f = self.client.post(path + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt')}).json['file']
        deleted = self.client.delete(path)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json['files'], [])
        self.assertEqual(len(deleted.json['buffers']), 1)
        self.assertNotEqual(deleted.json['buffers'][0]['id'], note['id'])
        self.assertEqual(self.client.get(f['download_url']).status_code, 404)
        self.assertEqual(self.client.put('/api/rooms/' + self.room['id'], json={'content': 'desktop'}).status_code, 200)
        self.assertEqual(self.client.get(self.root).json['buffers'][0]['content'], 'desktop')

    def test_json_errors_and_validation(self):
        for data in [[], {'title': ' '}, {'title': 'x' * 81}, {'content': 12}]:
            self.assertEqual(self.client.post(self.root + '/buffers', json=data).status_code, 400)
        malformed = self.client.post('/api/v1/rooms', data='{bad', content_type='application/json')
        self.assertEqual(malformed.status_code, 400)
        self.assertIn('error', malformed.json)
        self.assertEqual(self.client.post('/api/v1/rooms', data='text', content_type='text/plain').status_code, 415)
        self.assertEqual(self.client.get('/api/v1/rooms/ab12').status_code, 400)
        self.assertEqual(self.client.post(self.root + '/files').status_code, 400)
        self.assertEqual(self.client.post(self.root + '/files', data={'file': (io.BytesIO(b''), 'empty.txt')}).status_code, 400)
        self.assertEqual(self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt'), 'buffer_id': 'missing'}).status_code, 404)
        for response in [self.client.get('/api/v1/no-such-path'), self.client.put(self.root)]:
            self.assertIn(response.status_code, [404, 405])
            self.assertIn('error', response.json)

    def test_room_upload_expiry_and_headers(self):
        _rooms[self.room['id']].activity_at = time.time() - 100
        expiry = self.client.get(self.root).json['expires_at']
        self.assertEqual(self.client.get(self.root + '/files').json['expires_at'], expiry)
        note = self.room['buffers'][0]
        upload = self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt'), 'buffer_id': note['id']})
        self.assertGreater(upload.json['expires_at'], expiry)
        response = self.client.get(self.root)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'], '*')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        options = self.client.options(self.root + '/buffers/' + note['id'])
        self.assertIn('PATCH', options.headers['Access-Control-Allow-Methods'])
        _rooms[self.room['id']].activity_at = time.time() - 7201
        self.assertEqual(self.client.get(self.root).status_code, 404)

    def test_card_and_file_limits(self):
        for _ in range(29):
            self.assertEqual(self.client.post(self.root + '/buffers').status_code, 201)
        self.assertEqual(self.client.post(self.root + '/buffers').status_code, 400)
        for _ in range(20):
            self.assertEqual(self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt')}).status_code, 201)
        self.assertEqual(self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt')}).status_code, 400)

    def test_size_limits_and_leading_zero_room_code(self):
        _rooms['0042'] = Room()
        self.assertEqual(self.client.get('/api/v1/rooms/0042').json['id'], '0042')
        self.assertEqual(self.client.post(self.root + '/buffers', json={'content': 'x' * (MAX_TEXT_LENGTH + 1)}).status_code, 400)
        over = self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x' * (MAX_FILE_SIZE + 1)), 'over.bin')})
        self.assertEqual(over.status_code, 413)
        self.assertIn('error', over.json)
        for _ in range(2):
            self.assertEqual(self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x' * MAX_FILE_SIZE), 'exact.bin')}).status_code, 201)
        self.assertEqual(self.client.post(self.root + '/files', data={'file': (io.BytesIO(b'x'), 'room-full.bin')}).status_code, 413)

    def test_openapi_matches_flask_routes(self):
        response = self.client.get('/api/openapi.json', headers={'X-Forwarded-Proto': 'https'})
        self.assertEqual(response.status_code, 200)
        spec = response.json
        self.assertEqual(spec['security'], [])
        self.assertEqual(spec['servers'][0]['url'], 'https://localhost/api/v1')
        operations = []
        routes = {(rule.rule, method) for rule in app.url_map.iter_rules() for method in rule.methods}
        for path, methods in spec['paths'].items():
            flask_path = '/api/v1' + re.sub(r'\{([^}]+)\}', r'<\1>', path)
            for method, op in methods.items():
                self.assertIn((flask_path, method.upper()), routes)
                operations.append(op['operationId'])
        self.assertEqual(len(set(operations)), len(operations))
        self.assertEqual(len(operations), 14)
        self.assertEqual(self.client.get('/api/docs').status_code, 200)


if __name__ == '__main__':
    unittest.main()
