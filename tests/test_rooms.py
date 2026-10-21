import io
import unittest
from main import app, _rooms, ROOM_TTL_SEC


class RoomsTest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        _rooms.clear()
        self.client = app.test_client()
        self.rid = self.client.post('/api/rooms').json['id']
        self.url = '/api/rooms/' + self.rid

    def get(self):
        return self.client.get(self.url).json

    def test_pages_and_default_card(self):
        for url in ['/', '/r/' + self.rid, '/health']:
            self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(len(self.get()['notes']), 1)

    def test_independent_cards_and_conflicts(self):
        primary = self.get()['notes'][0]
        second = self.client.post(self.url + '/notes').json
        a = self.client.patch(self.url + '/notes/' + primary['id'], json={'version': 1, 'content': '<root/>', 'title': 'XML'})
        b = self.client.patch(self.url + '/notes/' + second['id'], json={'version': 1, 'content': '{"x": 1}'})
        self.assertEqual(a.status_code, 200)
        self.assertEqual(b.status_code, 200)
        stale = self.client.patch(self.url + '/notes/' + primary['id'], json={'version': 1, 'content': 'stale'})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json['note']['content'], '<root/>')
        self.assertEqual(self.get()['content'], '<root/>')

    def test_files_do_not_conflict_with_text_and_preserve_names(self):
        note = self.get()['notes'][0]
        legacy_revision = self.get()['updated_at']
        upload = self.client.post(self.url + '/files', data={'file': (io.BytesIO(b'hello'), 'пример.txt'), 'note_id': note['id']})
        self.assertEqual(upload.status_code, 201)
        f = upload.json['files'][0]
        self.assertEqual(f['name'], 'пример.txt')
        self.assertEqual(f['note_id'], note['id'])
        download = self.client.get(self.url + '/files/' + f['id'])
        self.assertEqual(download.data, b'hello')
        self.assertIn('filename*=UTF-8', download.headers['Content-Disposition'])
        update = self.client.put(self.url, json={'updated_at': legacy_revision, 'content': 'desktop'})
        self.assertNotIn('conflict', update.json)
        self.assertEqual(self.get()['notes'][0]['content'], 'desktop')
        self.assertEqual(self.client.delete(self.url + '/files/' + f['id']).status_code, 200)

    def test_delete_note_cascades_files_but_protects_primary(self):
        primary = self.get()['notes'][0]
        note = self.client.post(self.url + '/notes').json
        self.client.post(self.url + '/files', data={'file': (io.BytesIO(b'x'), 'x.txt'), 'note_id': note['id']})
        self.assertEqual(self.client.delete(self.url + '/notes/' + note['id']).status_code, 200)
        self.assertEqual(self.get()['files'], [])
        self.assertEqual(self.client.delete(self.url + '/notes/' + primary['id']).status_code, 400)

    def test_validation_and_expiry(self):
        self.assertEqual(self.client.put('/api/rooms/abcd', json={'content': 'x'}).status_code, 400)
        self.assertEqual(self.client.put(self.url, json={'content': 'x', 'updated_at': 'bad'}).status_code, 400)
        note = self.get()['notes'][0]
        for data in [{'version': 1, 'title': ''}, {'version': '1', 'content': 'x'}, []]:
            self.assertEqual(self.client.patch(self.url + '/notes/' + note['id'], json=data).status_code, 400)
        _rooms[self.rid].activity_at -= ROOM_TTL_SEC + 1
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.put(self.url, json={'content': 'x'}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
