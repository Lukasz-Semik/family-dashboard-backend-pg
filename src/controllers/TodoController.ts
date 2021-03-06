import {
  JsonController,
  UseBefore,
  Authorized,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Res,
} from 'routing-controllers';
import { getRepository } from 'typeorm';
import { isEmpty, find } from 'lodash';

import { internalServerErrors, defaultErrors, todosErrors } from '../constants/errors';
import { todosSuccesses } from '../constants/successes';
import { API_TODOS, API_TODO } from '../constants/routes';
import { allowedUpdateTodoPayloadKeys } from '../constants/allowedPayloadKeys';
import {
  RES_BAD_REQUEST,
  RES_CONFLICT,
  RES_SUCCESS,
  RES_INTERNAL_ERROR,
  RES_NOT_FOUND,
} from '../constants/resStatuses';
import { UserShortDataTypes, UserRoleDataTypes } from '../constants/sharedDataTypes';
import { checkIsProperUpdatePayload } from '../helpers/validators';
import { familyItemWithAuthorExecutorUpdaterQuery } from '../helpers/dbQueries';
import { validateUserPermissions } from '../validators/user';
import urlencodedParser, { jsonParser } from '../utils/bodyParser';
import { Family, User, Todo } from '../entity';
import { Token } from '.';

interface TodoDataTypes {
  title: string;
  description?: string;
  deadline?: string;
}

@JsonController()
export class TodoController {
  userRepository = getRepository(User);
  todoRepository = getRepository(Todo);
  familyRepository = getRepository(Family);

  familyWithTodosQuery = id =>
    this.familyRepository
      .createQueryBuilder('family')
      .leftJoin('family.todos', 'todos')
      .leftJoin('todos.author', 'author')
      .leftJoin('todos.executor', 'executor')
      .leftJoin('todos.updater', 'updater')
      .select(familyItemWithAuthorExecutorUpdaterQuery('todos'))
      .where('family.id = :id', { id })
      // tslint:disable-next-line semicolon
      .getOne();

  getCurrentUser = async req => {
    const { id: idDecoded } = await Token.decode(req.headers.authorization);

    const user = await this.userRepository.findOne({ id: idDecoded }, { relations: ['family'] });

    return user;
    // tslint:disable-next-line semicolon
  };

  // @description: post todo
  // @full route: /api/todos
  // @access: private
  @Post(API_TODOS)
  @UseBefore(urlencodedParser)
  @Authorized()
  async createTodo(@Req() req: any, @Res() res: any) {
    try {
      const { title, description, deadline } = req.body;

      if (isEmpty(title))
        return res.status(RES_BAD_REQUEST).json({ errors: { title: defaultErrors.isRequired } });

      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const todoData: TodoDataTypes = {
        title,
      };

      if (!isEmpty(description)) todoData.description = description;

      if (!isEmpty(deadline)) todoData.deadline = deadline;

      const newTodo = new Todo();

      const todo = await this.todoRepository.save({
        ...newTodo,
        ...todoData,
        author: user,
        isDone: false,
      });

      const family = await this.familyWithTodosQuery(user.family.id);

      family.todos.push(todo);

      await this.familyRepository.save(family);

      return res.status(RES_SUCCESS).json({ todos: todosSuccesses.todoCreated });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }

  // @description: get todos
  // @full route: /api/todos
  // @access: private
  @Get(API_TODOS)
  @Authorized()
  async getTodos(@Req() req: any, @Res() res: any) {
    try {
      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const family = await this.familyWithTodosQuery(user.family.id);

      return res.status(RES_SUCCESS).json({ todos: family.todos });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }

  // @description: delete all todos
  // @full route: /api/todos
  // @access: private
  @Delete(API_TODOS)
  @Authorized()
  async deleteAllFamilyTodos(@Req() req: any, @Res() res: any) {
    try {
      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
        checkIsFamilyHead: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const { todos } = await this.familyWithTodosQuery(user.family.id);

      if (isEmpty(todos))
        return res.status(RES_CONFLICT).json({ errors: { todos: todosErrors.alreadyEmpty } });

      const { id } = user.family;

      await this.todoRepository
        .createQueryBuilder('todos')
        .leftJoinAndSelect('todos.family', 'family')
        .delete()
        .where('family.id = :id', { id })
        .execute();

      return res.status(RES_SUCCESS).json({ todos: todosSuccesses.todosDeleted });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }

  // @description: get todo
  // @full route: /api/todos/:todoId
  // @access: private
  @Get(API_TODO().base)
  @Authorized()
  async getTodo(@Req() req: any, @Res() res: any) {
    try {
      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const { todos } = await this.familyWithTodosQuery(user.family.id);

      const { todoId } = req.params;

      const foundTodo = find(todos, todo => todo.id === Number(todoId));

      if (isEmpty(foundTodo))
        return res.status(RES_NOT_FOUND).json({ errors: { todo: defaultErrors.notFound } });

      return res.status(RES_SUCCESS).json({ todos: foundTodo });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }

  // @description: update todo
  // @full route: /api/todos/:todoId
  // @access: private
  @Patch(API_TODO().base)
  @Authorized()
  @UseBefore(urlencodedParser)
  @UseBefore(jsonParser)
  async updateTodo(@Req() req: any, @Res() res: any) {
    try {
      const {
        body: payload,
        params: { todoId },
      } = req;

      if (!checkIsProperUpdatePayload(payload, allowedUpdateTodoPayloadKeys))
        return res.status(400).json({ errors: { payload: defaultErrors.notAllowedValue } });

      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const { todos } = await this.familyWithTodosQuery(user.family.id);

      const foundTodo = find(todos, todo => todo.id === Number(todoId));

      if (isEmpty(foundTodo))
        return res.status(RES_NOT_FOUND).json({ errors: { todo: defaultErrors.notFound } });

      const userShortData: UserShortDataTypes = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
      };

      const userRoleData: UserRoleDataTypes = {
        updater: userShortData,
        executor: null,
      };

      userRoleData.executor = payload.isDone ? userShortData : undefined;

      const updatedTodo = await this.todoRepository.save({
        ...foundTodo,
        ...req.body,
        ...userRoleData,
      });

      return res.status(RES_SUCCESS).json({ updatedTodo });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }

  // @description: delete todo
  // @full route: /api/todos/:todoId
  // @access: private
  @Delete(API_TODO().base)
  @Authorized()
  async deleteTodo(@Req() req: any, @Res() res: any) {
    try {
      const user = await this.getCurrentUser(req);

      const { isValid, errors, status } = validateUserPermissions(user, {
        checkIsVerified: true,
        checkHasFamily: true,
      });

      if (!isValid) return res.status(status).json({ errors });

      const { todos } = await this.familyWithTodosQuery(user.family.id);

      const { todoId } = req.params;

      const foundTodo = find(todos, todo => todo.id === Number(todoId));

      if (isEmpty(foundTodo))
        return res.status(RES_NOT_FOUND).json({ errors: { todo: defaultErrors.notFound } });

      await this.todoRepository.remove(foundTodo);

      return res.status(RES_SUCCESS).json({ todo: foundTodo });
    } catch (err) {
      return res
        .status(RES_INTERNAL_ERROR)
        .json({ error: internalServerErrors.sthWrong, caughtError: err });
    }
  }
}
