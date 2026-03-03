from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import os
import base64

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///manuals.db'
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)


class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    color = db.Column(db.String(7), default='#3B82F6')
    icon = db.Column(db.String(10), default='📁')
    manuals = db.relationship('Manual', backref='category', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'icon': self.icon,
            'count': len(self.manuals),
        }


class Manual(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, default='')
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=True)
    tags = db.Column(db.String(500), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'content': self.content,
            'category_id': self.category_id,
            'category': self.category.to_dict() if self.category else None,
            'tags': [t.strip() for t in self.tags.split(',') if t.strip()] if self.tags else [],
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
        }


@app.route('/')
def index():
    return render_template('index.html')


# ── Categories ──────────────────────────────────────────────────────────────

@app.route('/api/categories', methods=['GET'])
def get_categories():
    return jsonify([c.to_dict() for c in Category.query.all()])


@app.route('/api/categories', methods=['POST'])
def create_category():
    data = request.json
    if Category.query.filter_by(name=data['name']).first():
        return jsonify({'error': '同じ名前のカテゴリが既に存在します'}), 400
    category = Category(
        name=data['name'],
        color=data.get('color', '#3B82F6'),
        icon=data.get('icon', '📁'),
    )
    db.session.add(category)
    db.session.commit()
    return jsonify(category.to_dict()), 201


@app.route('/api/categories/<int:cat_id>', methods=['PUT'])
def update_category(cat_id):
    category = Category.query.get_or_404(cat_id)
    data = request.json
    if 'name' in data:
        category.name = data['name']
    if 'color' in data:
        category.color = data['color']
    if 'icon' in data:
        category.icon = data['icon']
    db.session.commit()
    return jsonify(category.to_dict())


@app.route('/api/categories/<int:cat_id>', methods=['DELETE'])
def delete_category(cat_id):
    category = Category.query.get_or_404(cat_id)
    for manual in category.manuals:
        manual.category_id = None
    db.session.delete(category)
    db.session.commit()
    return '', 204


# ── Manuals ──────────────────────────────────────────────────────────────────

@app.route('/api/manuals', methods=['GET'])
def get_manuals():
    query = Manual.query
    search = request.args.get('search', '').strip()
    if search:
        like = f'%{search}%'
        query = query.filter(
            db.or_(
                Manual.title.like(like),
                Manual.content.like(like),
                Manual.tags.like(like),
            )
        )
    category_id = request.args.get('category_id')
    if category_id:
        query = query.filter(Manual.category_id == int(category_id))
    manuals = query.order_by(Manual.updated_at.desc()).all()
    return jsonify([m.to_dict() for m in manuals])


@app.route('/api/manuals', methods=['POST'])
def create_manual():
    data = request.json
    manual = Manual(
        title=data['title'],
        content=data.get('content', ''),
        category_id=data.get('category_id') or None,
        tags=','.join(data.get('tags', [])),
    )
    db.session.add(manual)
    db.session.commit()
    return jsonify(manual.to_dict()), 201


@app.route('/api/manuals/<int:manual_id>', methods=['GET'])
def get_manual(manual_id):
    return jsonify(Manual.query.get_or_404(manual_id).to_dict())


@app.route('/api/manuals/<int:manual_id>', methods=['PUT'])
def update_manual(manual_id):
    manual = Manual.query.get_or_404(manual_id)
    data = request.json
    if 'title' in data:
        manual.title = data['title']
    if 'content' in data:
        manual.content = data['content']
    if 'category_id' in data:
        manual.category_id = data['category_id'] or None
    if 'tags' in data:
        manual.tags = ','.join(data['tags'])
    manual.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify(manual.to_dict())


@app.route('/api/manuals/<int:manual_id>', methods=['DELETE'])
def delete_manual(manual_id):
    manual = Manual.query.get_or_404(manual_id)
    db.session.delete(manual)
    db.session.commit()
    return '', 204


# ── OCR ──────────────────────────────────────────────────────────────────────

@app.route('/api/ocr', methods=['POST'])
def ocr_image():
    if 'image' not in request.files:
        return jsonify({'error': '画像ファイルが見つかりません'}), 400
    file = request.files['image']
    if not file.filename:
        return jsonify({'error': 'ファイルが選択されていません'}), 400

    image_data = file.read()
    image_base64 = base64.standard_b64encode(image_data).decode('utf-8')

    fname = file.filename.lower()
    if fname.endswith('.png'):
        media_type = 'image/png'
    elif fname.endswith('.gif'):
        media_type = 'image/gif'
    elif fname.endswith('.webp'):
        media_type = 'image/webp'
    else:
        media_type = 'image/jpeg'

    try:
        import anthropic
        client = anthropic.Anthropic()
        message = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=4096,
            messages=[{
                'role': 'user',
                'content': [
                    {
                        'type': 'image',
                        'source': {
                            'type': 'base64',
                            'media_type': media_type,
                            'data': image_base64,
                        },
                    },
                    {
                        'type': 'text',
                        'text': (
                            'この画像に書かれているテキストを読み取り、Markdown形式で書き起こしてください。'
                            '手書きのメモや文書の場合、できるだけ正確に文字を認識してください。'
                            '見出しは ## や ###、箇条書きは - を使って整形してください。'
                            '読み取ったテキストのみを出力し、前置きや説明は一切不要です。'
                        ),
                    },
                ],
            }],
        )
        return jsonify({'transcription': message.content[0].text})
    except Exception as exc:
        return jsonify({'error': f'OCR処理中にエラーが発生しました: {exc}'}), 500


# ── Bootstrap ─────────────────────────────────────────────────────────────────

def seed_defaults():
    if Category.query.count() == 0:
        defaults = [
            Category(name='研修', color='#3B82F6', icon='🎓'),
            Category(name='日常業務', color='#10B981', icon='💼'),
            Category(name='マニュアル', color='#F59E0B', icon='📋'),
            Category(name='メモ', color='#8B5CF6', icon='📝'),
        ]
        for cat in defaults:
            db.session.add(cat)
        db.session.commit()


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        seed_defaults()
    app.run(debug=True, port=5000)
